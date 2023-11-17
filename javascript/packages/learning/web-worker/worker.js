onmessage = function(e) {
    console.log('Worker: Message received from main script');
    const result = e.data[0] * e.data[1];
    if (isNaN(result)) {
        postMessage('Please write two numbers');
    } else {
        const workerResult = 'Result: ' + result;
        console.log('Worker: Posting message back to main script');
        postMessage(workerResult);
    }
}

const state = {
    title: "very complex state!",
    nested: {
        first: 1,
        second: {
            first: 1,
            second: 2,
        },
        third: [3,2,1]
    }
}

setInterval(() => {
    state.nested.first = Math.random() * 1000 % 10;
    state.nested.third[2] = Math.random() * 1000 % 20;
}, 0);

const loop = () => {
    const copy = { ...state };
    postMessage(copy);
    requestAnimationFrame(loop)
}

loop();