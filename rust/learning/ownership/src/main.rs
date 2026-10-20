const CONST_STR: u32 = 2;

fn main() {
    let str = String::from("zdarova zaebal");

    let str2 = take_ownership(str);

    // println!("{}", str); // won't compile: not is owner or borrowed ref
    println!("{}", str2);

    let clever_number = CONST_STR;

    take_ownership_scalar(clever_number);

    println!("{}", clever_number);

    println!("{}", hello_man());

    fn hello_man() -> String {
        String::from("lol")   
    }
    
    // refs can be taken infinite amount of times
    let str2_ref = &str2;
    let str2_ref2 = &str2;

    println!("{} = {}", str2_ref, str2_ref2);

    let mut str3 = String::from("zdarova zaebal");

    let str3_mut_ref = &mut str3;
    // let str3_mut_str2 = &mut str3; // won't compile: only one link

    str3_mut_ref.push_str("a");

    println!("{}", str3);

    let mut str4 = String::from("zdarova zaebal");
    
    let _str4_ref = &str4;
    let str4_ref2 = &str4;

    // let str4_mut_ref = &mut str4; // won't compile: can't have mutuable reference & readonly reference at the same time

    println!("{}", str4_ref2);
}

fn take_ownership(str: String) -> String {
    let mut new_str: String = str;

    new_str.push_str("bar");

    // println!("{}", str); // won't compile: not is owner or borrowed ref

    new_str
}

fn take_ownership_scalar(num: u32) {
    println!("{}", num);
}