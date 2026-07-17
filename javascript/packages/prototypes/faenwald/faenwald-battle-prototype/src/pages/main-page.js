const renderMainPage = () => {
  const root = document.querySelector("main");

  root.innerHTML = `
    <nav style="display: flex; flex-direction: column; align-items: center; gap: 16px; padding-top: 96px;">
      <a href="#/game" style="display: block; width: 170px; padding: 12px 0; border: 1px solid #000; text-align: center; text-decoration: none; color: inherit; font-family: sans-serif;">Battle Creation</a>
      <a href="#/modifiers" style="display: block; width: 170px; padding: 12px 0; border: 1px solid #000; text-align: center; text-decoration: none; color: inherit; font-family: sans-serif;">Modifiers Table</a>
    </nav>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderMainPage }
