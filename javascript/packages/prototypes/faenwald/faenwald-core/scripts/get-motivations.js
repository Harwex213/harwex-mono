import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const getMotivation = (motivationsMeta) => {
  const number = Math.trunc(Math.random() * 29) + 1;

  const motivation = motivationsMeta.find(({ range }) => range.from <= number && number <= range.to);

  return motivation.name;
};

const getCharactersMotivation = (lord, motivationsMeta) => {
  let numberOfMotivations = 1;

  if (lord.age >= 30) {
    numberOfMotivations++;
  }
  if (lord.age >= 50) {
    numberOfMotivations++;
  }
  if (lord.age >= 70) {
    numberOfMotivations++;
  }

  for (let i = 0; i < numberOfMotivations; i++) {
    const motivation = getMotivation(motivationsMeta);
    if (!lord.motivations.includes(motivation)) {
      lord.motivations.push(motivation);
    }
  }
};

const main = async () => {
  const motivationsMeta = JSON.parse(
    await readFile(join(__dirname, 'existed-motivations.json'), 'utf-8')
  );

  const csvText = await readFile(
    join(__dirname, 'lords.csv'),
    'utf-8'
  );

  const [, ...rows] = csvText.trim().split('\n');

  const lords = rows.map((row) => {
    const cols = row.split(',');
    return {
      name: cols[1],
      age: parseInt(cols[5], 10),
      family: cols[8] ?? '',
      motivations: [],
    };
  });

  for (const lord of lords) {
    getCharactersMotivation(lord, motivationsMeta);
  }

  const outputRows = [
    'name,age,family,motivations',
    ...lords.map(({ name, age, family, motivations }) =>
      `${name},${age},${family},"${motivations.join(',')}"`
    ),
  ];

  await writeFile(join(__dirname, 'lords-with-motivations.csv'), outputRows.join('\n'), 'utf-8');

  console.log(`Done. Processed ${lords.length} lords.`);
};

main();
