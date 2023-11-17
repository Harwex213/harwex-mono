const error = (reason) => new Error(reason);

const switcherAlreadyStartedListening = () => error("Switcher already started listening");

export { switcherAlreadyStartedListening };
