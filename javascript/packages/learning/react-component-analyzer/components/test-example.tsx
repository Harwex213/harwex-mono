import React from 'react';
import { Button } from './Button';
import { Header } from './Header';
import { Footer } from './Footer';

const ShouldBeIgnored = () => {
  return <div>ShouldBeIgnored</div>;
};

const ShouldBeAnalyzed = () => {
  return <div>ShouldBeAnalyzed</div>;
};

interface AppProps {
  title: string;
}

export function App({ title }: AppProps) {
  return (
    <div className="app">
      <Header title={title}/>
      <main>
        <Button onClick={() => console.log('clicked')}>
          Click me
        </Button>
      </main>

      <ShouldBeAnalyzed/>
      <Footer/>
    </div>
  );
}

export default App; 