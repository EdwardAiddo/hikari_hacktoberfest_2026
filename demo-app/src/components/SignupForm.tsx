import { useState, type FormEvent } from "react";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSent(true);
  }

  return (
    <form className="signup" onSubmit={submit}>
      <h2>Get early access</h2>
      <input
        type="email"
        className="signup-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <p className="signup-hint">We send one email when your invite is ready. No spam.</p>
      <button type="submit" className="signup-submit">
        Join the waitlist
      </button>
      {sent && <p role="status">Thanks! Check your inbox.</p>}
    </form>
  );
}
