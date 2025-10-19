import React, { useState } from 'react';
import Button from './components/Button';
import Card from './components/Card';
import styles from './App.module.css';

const App = () => {
  const [count, setCount] = useState(0);

  const handleIncrement = () => setCount(count + 1);
  const handleDecrement = () => setCount(count - 1);
  const handleReset = () => setCount(0);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>React + Webpack + CSS Modules</h1>
        <p className={styles.subtitle}>A modern development setup</p>
      </header>

      <main className={styles.main}>
        <Card title="Counter Example">
          <div className={styles.counter}>
            <div className={styles.countDisplay}>
              Count: <span className={styles.countValue}>{count}</span>
            </div>
            <div className={styles.buttonGroup}>
              <Button variant="danger" onClick={handleDecrement}>
                Decrement
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                Reset
              </Button>
              <Button variant="success" onClick={handleIncrement}>
                Increment
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Button Variants">
          <div className={styles.buttonShowcase}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="success">Success</Button>
            <Button variant="danger">Danger</Button>
          </div>
        </Card>

        <Card title="CSS Modules Demo">
          <p>
            This project demonstrates the use of CSS Modules with Webpack.
            Each component has its own scoped styles that won't conflict with other components.
          </p>
          <ul className={styles.featureList}>
            <li>✅ React 18 with modern JSX transform</li>
            <li>✅ Webpack 5 with hot module replacement</li>
            <li>✅ CSS Modules for scoped styling</li>
            <li>✅ Babel for modern JavaScript features</li>
            <li>✅ Development server with live reload</li>
          </ul>
        </Card>
      </main>
    </div>
  );
};

export default App;
