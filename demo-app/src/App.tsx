import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { SignupForm } from "./components/SignupForm";

export default function App() {
  return (
    <>
      <Header />
      <main className="page">
        <h1>Notes that stay out of your way</h1>
        <p className="intro">
          Hikari Notes keeps your ideas in one calm place, synced across your devices.
        </p>
        <SignupForm />
      </main>
      <Footer />
    </>
  );
}
