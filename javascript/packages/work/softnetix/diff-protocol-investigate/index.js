/**
 *  В итоге мы имеем просто массив, в который складываем значения до предела, заданного параметром конструктора.
 *  При переполнении буфера просто начинаем с 0 до size-1 класть новые значения (старые затираются)
 */
class Buffer {
    pointer = 0;
    buffer = [];

    constructor(size) {
        this.size = size;
    }

    add(item) {
        if(this.buffer.length === this.size) {
            this.buffer[this.pointer] = item;
        } else {
            this.buffer.push(item);
        }

        this.pointer = (this.pointer + 1) % this.size;
    }

    flush() {
        this.pointer = 0;

        return this.buffer.splice(0, this.size);
    }
}

const buff = new Buffer(3);
buff.add(123);
buff.add(321);
buff.add(333); // buff.buffer [123, 321, 333]
buff.add(444); // buff.buffer [444, 321, 333]
buff.add(555); // buff.buffer [444, 555, 333]
