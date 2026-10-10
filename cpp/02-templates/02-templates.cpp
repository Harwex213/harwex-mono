#include <iostream>

// plain templates

template <typename T>
T max(T a, T b) { return a > b ? a : b; }

template <typename T>
struct Box { T value; };

// template specialization

template <typename T>
struct Describe {
    static const char* name() { return "something"; }   
};

template <>
struct Describe<bool> {
    static const char* name() { return "bool"; }   
};

template <typename T>
struct Describe<T*> {
    static const char* name() { return "pointer"; }
};

template <typename T>
void logValue(const T& x) {
    std::cout << Describe<T>::name() << std::endl;
}

int main() {
    Box<float> box { 1.2 };
    
    bool isLogged = false;
    bool* pIsLogged = &isLogged;

    logValue(isLogged);
    logValue(pIsLogged);

    std::cout << "hi" << std::endl << max(1, 2) << std::endl << box.value << std::endl;
    return 0;
}