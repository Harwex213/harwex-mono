const context = {
    state: null,
    result: document.querySelector('.result')
};

const loop = () => {
    context.result.innerHTML = JSON.stringify(context.state);
    requestAnimationFrame(loop);
}
loop();

if (window.Worker) {
    const myWorker = new Worker(
        new URL('worker.js', import.meta.url),{ type: 'module' }
    );

    myWorker.onmessage = function(e) {
        context.state = e.data;
    }
} else {
    console.log('Your browser doesn\'t support web workers.');
}
