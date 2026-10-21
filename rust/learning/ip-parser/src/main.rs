fn main() {
    let input = String::from("46.101.192.0/18");

    let parsed_ip: ParsedIp = parse_ip(&input);

    println!("{}", parsed_ip.ip[0]);    
    println!("{}", parsed_ip.mask[0]);    
    println!("{}", parsed_ip.network[0]);    
}

struct ParsedIp {
    ip: [u16; 4],
    mask: [u16; 4],
    network: [u16; 4],
}

fn parse_ip(ip: &str) -> ParsedIp {
    for ip_number in ip.chars() {
        let number: u32 = ip_number.to_digit(10).unwrap_or_default();
        println!("{number}");
    }

    return ParsedIp {
        ip: [0, 0, 0, 0],
        mask: [0, 0, 0, 0],
        network: [0, 0, 0, 0],
    };
}
