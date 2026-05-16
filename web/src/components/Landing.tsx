import { useState } from 'react';
import ConnectForm from './ConnectForm';
import RoomDirectory from './RoomDirectory';

export default function Landing() {
  const [port, setPort] = useState('');

  return (
    <>
      <ConnectForm port={port} onPortChange={setPort} />
      <RoomDirectory joinPort={(() => { const n = parseInt(port, 10); return Number.isFinite(n) ? n : 9002; })()} />
    </>
  );
}
