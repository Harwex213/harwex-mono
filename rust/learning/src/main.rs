use std::io;
use rand::prelude::*;

fn main() {
    let secret_number = rand::rng().random_range(1..=100);

    let mut guess: u32;

    loop {
        guess = take_number_from_user();

        if guess == secret_number {
            println!("ты ввёл нумбер {guess} и сука угадал!");
            break;
        }
        
        let temperature = get_temperature_value(secret_number, guess);

        println!("ты ввёл нумбер {guess}, но не угадал! Температурка: {temperature}");
    }
}

fn take_number_from_user() -> u32 {
    println!("Введи нумбер");

    let mut guess = String::new();

    io::stdin()
        .read_line(&mut guess)
        .expect("ты точно нумбер ввёл?");
    
    let guess: u32 = guess.trim().parse().expect("ты ввёл не нумбер бро...");

    return guess;
}

fn get_temperature_value(secret_number: u32, guess: u32) -> String {
    let diff: u32 = secret_number.abs_diff(guess);

    if diff < 8 {
        return "Горячо".to_string();
    }
    if diff < 15 {
        return "Тепло".to_string();
    }
    if diff < 25 {
        return "Теплее".to_string();
    }
    if diff < 40 {
        return "Холодно".to_string();
    }

    return "крайне Холодно".to_string();
}
