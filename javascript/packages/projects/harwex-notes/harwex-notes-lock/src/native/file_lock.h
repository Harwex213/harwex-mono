#ifndef HARWEX_FILE_LOCK_H
#define HARWEX_FILE_LOCK_H

#include <string>

namespace harwex {

struct Locker {
    int file_descriptor = -1;
    bool should_block = false;
    int error_code = 0;
};

Locker lock_file(const std::string &lock_path, bool wait_for_lock);
bool unlock_file(int file_descriptor);

} // namespace harwex

#endif
