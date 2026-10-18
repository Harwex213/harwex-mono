const CONST_STR: u32 = 2;

fn main() {
    let str = String::from("zdarova zaebal");

    let str2 = take_ownership(str);

    println!("{}", str2);

    let clever_number = CONST_STR;

    take_ownership_scalar(clever_number);

    println!("{}", clever_number);

    println!("{}", hello_man());

    fn hello_man() -> String {
        String::from("lol")   
    }
}

fn take_ownership(str: String) -> String {
    let mut new_str: String = str;

    new_str.push_str("bar");

    // println!("{}", str);

    new_str
}

fn take_ownership_scalar(num: u32) {
    println!("{}", num);
}