import * as fs from "node:fs";

const main = async () => {
  const provinces = JSON.parse(fs.readFileSync("./provinces.json").toString());

  for (const provincesId in provinces) {
    const province = provinces[provincesId];
    province.provinceId = provincesId;
  }

  fs.writeFileSync("./provinces.json", JSON.stringify(provinces, null, 2));
};

void main();