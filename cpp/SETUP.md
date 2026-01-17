# C++ Development Environment Setup

This directory contains cross-platform C++ projects using CMake and vcpkg.

## Initial Setup

### 1. Install Prerequisites

**macOS:**
```bash
# Install Xcode Command Line Tools (includes Clang)
xcode-select --install

# Install CMake and Ninja via Homebrew
brew install cmake ninja
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install build-essential cmake ninja-build git curl zip unzip tar
```

**Windows:**
- Install Visual Studio 2022 with "Desktop development with C++" workload
- Or install Build Tools for Visual Studio 2022
- Install CMake from https://cmake.org/download/

### 2. Set Up vcpkg (Package Manager)

From the monorepo root:

```bash
# Clone vcpkg
git clone https://github.com/microsoft/vcpkg.git

# Bootstrap vcpkg
./vcpkg/bootstrap-vcpkg.sh   # macOS/Linux
# .\vcpkg\bootstrap-vcpkg.bat  # Windows (PowerShell)
```

### 3. Build the Project

```bash
cd cpp

# Configure (first time - will install dependencies via vcpkg)
cmake --preset debug

# Build
cmake --build --preset debug

# Run hello-world example
./build/debug/packages/hello-world/hello-world  # macOS/Linux
# .\build\debug\packages\hello-world\hello-world.exe  # Windows
```

## VS Code Integration

Install these extensions:
- **CMake Tools** (`ms-vscode.cmake-tools`)
- **C/C++** (`ms-vscode.cpptools`)

The `.vscode/settings.json` is already configured for CMake integration.

## Project Structure

```
cpp/
├── CMakeLists.txt          # Root CMake configuration
├── CMakePresets.json       # Cross-platform build presets
├── vcpkg.json              # Dependencies manifest
└── packages/
    └── hello-world/        # Example package
        ├── CMakeLists.txt
        └── src/
            └── main.cpp
```

## Adding New Packages

1. Create a new directory: `packages/your-package/`
2. Add `CMakeLists.txt` in your package directory
3. Add `add_subdirectory(packages/your-package)` to the root `CMakeLists.txt`

## Adding Dependencies

1. Find packages on https://vcpkg.io/
2. Add to `vcpkg.json` dependencies array
3. Use `find_package()` in your package's CMakeLists.txt
4. Link with `target_link_libraries()`

Example:
```cmake
find_package(fmt CONFIG REQUIRED)
target_link_libraries(your-target PRIVATE fmt::fmt)
```

## Building for Release

```bash
cmake --preset release
cmake --build --preset release
```

