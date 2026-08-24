#include <iostream>

void g(char c, signed char sc, unsigned char uc) {
    c = 255;
    std::cout << c << std::endl;

    c = sc;
    c = uc;
    sc = uc;
    uc = sc;
    sc = c;
    uc = c;
}

int main() {
  std::cout << "Hello World!\n";

  g('a', 'b', 'c');

  return 0;
}
