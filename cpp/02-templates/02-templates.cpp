#include <iostream>

template <typename T>
T max(T a, T b) { return a > b ? a : b; }

template <typename T>
struct Box { T value; };

int main() {
    Box<float> box { 1.2 };
    
    std::cout << "hi" << std::endl << max(1, 2) << std::endl << box.value << std::endl;
    return 0;
}