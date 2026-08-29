cmake_minimum_required(VERSION 3.15)
project(harwex_notes_lock)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

execute_process(
        COMMAND node -p "require('node-addon-api').include_dir"
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        OUTPUT_VARIABLE NODE_ADDON_API_DIR
        ERROR_QUIET
        OUTPUT_STRIP_TRAILING_WHITESPACE
)

include_directories(${NODE_ADDON_API_DIR} ${CMAKE_JS_INC})

add_library(${PROJECT_NAME} SHARED
        src/native/binding.cpp
        src/native/file_lock.cpp
        ${CMAKE_JS_SRC})

set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})

# Стабильный ABI: аддон не надо пересобирать под каждую минорную версию Node.
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)
target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra)

if (APPLE)
    set_target_properties(${PROJECT_NAME} PROPERTIES
            MACOSX_RPATH ON
            BUILD_WITH_INSTALL_RPATH ON)
endif ()
