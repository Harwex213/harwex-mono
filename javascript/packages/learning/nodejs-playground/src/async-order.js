const asyncOrderFactory = (maxIterations) => {
  let currentNumber = 0;
  let timer = null;
  const tasks = {};

  return (number) => {
    if (!timer) {
      timer = setInterval(() => {
        currentNumber++;
        const currentTask = tasks[currentNumber];

        if (currentTask) {
          currentTask();
        }

        if (currentNumber === maxIterations) {
          clearInterval(timer);
        }
      }, 0);
    }

    console.log(`schedule ${number}`);

    return new Promise((resolve) => {
      tasks[number] = () => resolve(number);
    });
  };
};

const asyncOrder = asyncOrderFactory(10);

asyncOrder(1).then(() => {
  console.log(`post 1`);
});
asyncOrder(3).then(() => {
  console.log(`post 3`);
});
asyncOrder(2).then(() => {
  console.log(`post 2`);
});