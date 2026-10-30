import { useState } from "react";
import { Plus, Upload } from "lucide-react";
import { useTitle } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { PageHeader } from "../../components/ui/Navigation";
import { Button, ButtonLink } from "../../components/ui/Button";
import { ContactsTable } from "../../components/contacts/ContactsTable";
import { NewContactDialog } from "../../components/contacts/ContactDialogs";

export function ContactsPage() {
  useTitle("Contacts");
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone you can reach. Put contacts into lists to use them in campaigns."
        actions={
          can("contacts.manage") && (
            <>
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add contact</Button>
              <ButtonLink to="/contacts/import" variant="primary" icon={<Upload className="h-4 w-4" />}>Import</ButtonLink>
            </>
          )
        }
      />
      <ContactsTable emptyAction={can("contacts.manage") && <ButtonLink to="/contacts/import" variant="primary">Import contacts</ButtonLink>} />
      <NewContactDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
