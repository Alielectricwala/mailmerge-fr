// Advanced multi-template campaign creation and edit workflow
import { useParams } from "react-router-dom";
import { useCampaign } from "../../lib/queries";
import { useTitle } from "../../lib/hooks";
import { PageHeader } from "../../components/ui/Navigation";
import { Callout, ErrorState } from "../../components/ui/Feedback";
import { PageLoader } from "../../components/ui/Spinner";
import { AdvancedCampaignStudio } from "../../components/campaigns/AdvancedCampaignStudio";

export function CampaignFormPage() {
  const { id } = useParams();
  const isNew = !id;
  useTitle(isNew ? "New campaign" : "Edit campaign");
  const existing = useCampaign(id ?? "");

  if (!isNew && existing.isPending) return <PageLoader />;
  if (!isNew && existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;

  if (!isNew && existing.data && existing.data.data.status !== "DRAFT") {
    return (
      <>
        <PageHeader back={{ to: `/campaigns/${id}`, label: existing.data.data.name }} title="Edit campaign" />
        <Callout tone="info">Only drafts can be edited. Return it to draft first, or duplicate it.</Callout>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={isNew ? { to: "/campaigns", label: "Campaigns" } : { to: `/campaigns/${id}`, label: existing.data?.data.name ?? "Campaign" }}
        title={isNew ? "New campaign" : `Edit ${existing.data?.data.name ?? "campaign"}`}
        description="Select multiple templates, configure segment targeting rules, and review recipient distribution before approval."
      />
      <div className="max-w-5xl">
        <AdvancedCampaignStudio campaignId={id} />
      </div>
    </>
  );
}
