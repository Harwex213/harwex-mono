add_executable(hello-world src/main.cpp)

# Find and link the fmt library (from vcpkg)
find_package(fmt CONFIG REQUIRED)
target_link_libraries(hello-world PRIVATE fmt::fmt)

