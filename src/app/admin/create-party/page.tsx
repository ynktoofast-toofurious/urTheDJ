import { CreatePartyForm } from '@/components/create-party-form';

export default function CreatePartyPage() {
  return (
    <main className="app-frame stack">
      <section className="hero">
        <p className="eyebrow">Admin setup</p>
        <h1>Start the room before the first request arrives.</h1>
        <p className="hero-copy">
          Set the party name, optionally describe the starting style, and create a session link the DJ can open on a laptop or tablet at the venue.
        </p>
      </section>
      <CreatePartyForm />
    </main>
  );
}
