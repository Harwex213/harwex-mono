import { useState } from "react";
import { Dialog, DialogTitle } from "./dialog";
import { Button } from "../button/button";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Open Dialog</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTitle>Declare War</DialogTitle>
        <p style={{ marginTop: 8 }}>Are you sure you want to declare war on Nordheim? This action cannot be undone.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>Confirm</Button>
        </div>
      </Dialog>
    </>
  );
}

export default {
  name: "Dialog",
  render: () => (
    <>
      <ShowcaseSection title="Default">
        <DialogDemo/>
      </ShowcaseSection>
    </>
  ),
};
