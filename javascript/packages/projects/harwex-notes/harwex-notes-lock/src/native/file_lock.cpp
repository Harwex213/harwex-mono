#include "file_lock.h"

#include <cerrno>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>

namespace harwex {

Locker lock_file(const std::string &lock_path, bool wait_for_lock) {
    Locker locker;

    int file_descriptor = ::open(lock_path.c_str(), O_RDWR | O_CREAT | O_CLOEXEC, 0644);

    if (file_descriptor < 0 && errno == EISDIR) {
        file_descriptor = ::open(lock_path.c_str(), O_RDONLY | O_CLOEXEC);
    }

    if (file_descriptor < 0) {
        locker.error_code = errno;
        return locker;
    }

    const int operation = LOCK_EX | (wait_for_lock ? 0 : LOCK_NB);

    while (::flock(file_descriptor, operation) < 0) {
        if (errno == EINTR)
            continue;

        if (!wait_for_lock && (errno == EWOULDBLOCK || errno == EAGAIN)) {
            locker.should_block = true;
            ::close(file_descriptor);
            return locker;
        }

        locker.error_code = errno;
        ::close(file_descriptor);
        return locker;
    }

    locker.file_descriptor = file_descriptor;
    return locker;
}

bool unlock_file(int file_descriptor) {
    if (file_descriptor < 0) {
        return false;
    }

    const bool unlocked = ::flock(file_descriptor, LOCK_UN) == 0;
    const bool closed = ::close(file_descriptor) == 0;
    return unlocked && closed;
}

} // namespace harwex
