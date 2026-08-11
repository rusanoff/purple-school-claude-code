'use client';

import { Button } from '@heroui/react';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="text-2xl font-semibold">Hello world!</div>
      <Button onPress={() => console.log('Button pressed')}>Click me</Button>
    </main>
  );
}
