import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [msg, setMsg] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setMsg(await invoke("ffmpeg_help", { }));
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <button onClick={() => greet()}>ffmpeg --help</button>
      <p>{msg}</p>
    </main>
  );
}

export default App;
