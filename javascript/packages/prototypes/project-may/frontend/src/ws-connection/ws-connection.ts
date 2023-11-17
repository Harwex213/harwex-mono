type TAppMessage = {
  action: string;
  payload: any;
}

const launchWsConnection = () => {
  console.log("Я типа стартую ws connection");
};

export { launchWsConnection };
