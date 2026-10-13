import type { FC } from "react";

const Footer: FC = () => {
  return (
    <footer className="footer">
      <p className="footer__slogan">Откат до базовых.</p>
      <div className="footer__row">
        <span>© 2026 Метод Каловцева</span>
        <span>
          Это сатира. Если вам по-настоящему плохо — психолог всё-таки нужен.
        </span>
      </div>
    </footer>
  );
};

export { Footer };
