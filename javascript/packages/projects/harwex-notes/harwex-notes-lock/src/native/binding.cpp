#include "file_lock.h"

#include <cstring>
#include <napi.h>

namespace {

std::string describe(int error_code) {
    return std::strerror(error_code);
}

class LockFileWorker : public Napi::AsyncWorker {
public:
    LockFileWorker(Napi::Env env, std::string lock_path)
        : Napi::AsyncWorker(env), lock_path_(std::move(lock_path)),
          deferred_(Napi::Promise::Deferred::New(env)) {}

    Napi::Promise promise() { return deferred_.Promise(); }

    void Execute() override { locker_ = harwex::lock_file(lock_path_, true); }

    void OnOK() override {
        Napi::Env env = Env();

        if (locker_.file_descriptor < 0) {
            deferred_.Reject(Napi::Error::New(env, "cannot take lock " + lock_path_ + ": " +
                                                           describe(locker_.error_code))
                                     .Value());
            return;
        }

        deferred_.Resolve(Napi::Number::New(env, locker_.file_descriptor));
    }

    void OnError(const Napi::Error &error) override { deferred_.Reject(error.Value()); }

private:
    std::string lock_path_;
    Napi::Promise::Deferred deferred_;
    harwex::Locker locker_;
};

bool read_path(const Napi::CallbackInfo &info, std::string &path) {
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(info.Env(), "need lock path (string)")
                .ThrowAsJavaScriptException();
        return false;
    }

    path = info[0].As<Napi::String>().Utf8Value();
    return true;
}

Napi::Value LockFileAndWait(const Napi::CallbackInfo &info) {
    std::string path;

    if (!read_path(info, path)) {
        return info.Env().Undefined();
    }

    auto *worker = new LockFileWorker(info.Env(), path);
    Napi::Promise promise = worker->promise();
    worker->Queue();
    return promise;
}

Napi::Value LockFileIfFree(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string path;

    if (!read_path(info, path)) {
        return env.Undefined();
    }

    const harwex::Locker locker = harwex::lock_file(path, false);

    if (locker.should_block) {
        return env.Null();
    }

    if (locker.file_descriptor < 0) {
        Napi::Error::New(env, "cannot took lock " + path + ": " + describe(locker.error_code))
                .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return Napi::Number::New(env, locker.file_descriptor);
}

Napi::Value UnlockFile(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "need file descriptor (number)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    return Napi::Boolean::New(env, harwex::unlock_file(info[0].As<Napi::Number>().Int32Value()));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("lockFileAndWait", Napi::Function::New(env, LockFileAndWait));
    exports.Set("lockFileIfFree", Napi::Function::New(env, LockFileIfFree));
    exports.Set("unlockFile", Napi::Function::New(env, UnlockFile));
    return exports;
}

} // namespace

NODE_API_MODULE(harwex_notes_lock, Init)
