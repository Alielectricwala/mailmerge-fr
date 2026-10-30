// Multi-template eligibility, priority targeting rules, and recipient overrides
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Edit2,
  Plus,
  ShieldCheck,
  Split,
  Star,
  Trash2,
  UserCheck,
} from "lucide-react";
import {
  HOTEL_SEGMENTS,
  HOTEL_SEGMENT_LABELS,
  CONTACT_PERSONAS,
  CONTACT_PERSONA_LABELS,
  type CampaignRuleDto,
  type CampaignTemplateDto,
  type CampaignRecipientOverrideDto,
  type HotelSegment,
  type ContactPersona,
} from "@shared/types";
import { api, errorMessage } from "../../lib/api";
import { useInvalidate, useTemplates, type CampaignDetail } from "../../lib/queries";
import { useToast } from "../ui/Toast";
import { Panel } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Dialog, ConfirmDialog } from "../ui/Overlay";
import { TextField, SelectField, Checkbox } from "../ui/Field";
import { Callout } from "../ui/Feedback";

interface TemplateRulesPanelProps {
  campaign: CampaignDetail;
  readOnly?: boolean;
}

export function TemplateRulesPanel({ campaign, readOnly = false }: TemplateRulesPanelProps) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const workspaceTemplates = useTemplates();

  // Queries for campaign rules, templates, and overrides
  const templatesQuery = useQuery({
    queryKey: ["campaigns", campaign.id, "templates"],
    queryFn: () => api.get<CampaignTemplateDto[]>(`/api/campaigns/${campaign.id}/templates`),
    initialData: { data: campaign.templates ?? [] } as any,
  });

  const rulesQuery = useQuery({
    queryKey: ["campaigns", campaign.id, "rules"],
    queryFn: () => api.get<CampaignRuleDto[]>(`/api/campaigns/${campaign.id}/rules`),
    initialData: { data: campaign.rules ?? [] } as any,
  });

  const overridesQuery = useQuery({
    queryKey: ["campaigns", campaign.id, "overrides"],
    queryFn: () => api.get<CampaignRecipientOverrideDto[]>(`/api/campaigns/${campaign.id}/overrides`),
  });

  const refreshAll = async () => {
    await invalidate("campaigns");
    await Promise.all([
      templatesQuery.refetch(),
      rulesQuery.refetch(),
      overridesQuery.refetch(),
    ]);
  };

  // Dialog states
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [selectedNewTemplateId, setSelectedNewTemplateId] = useState("");
  const [isNewTemplateFallback, setIsNewTemplateFallback] = useState(false);

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CampaignRuleDto | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    templateId: string;
    priority: number;
    description: string;
    hotelSegment: string;
    contactPersona: string;
    city: string;
    requiresVerified: boolean;
    minConfidence: string;
  }>({
    templateId: "",
    priority: 1,
    description: "",
    hotelSegment: "",
    contactPersona: "",
    city: "",
    requiresVerified: false,
    minConfidence: "",
  });

  const [deleteRuleTarget, setDeleteRuleTarget] = useState<CampaignRuleDto | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<CampaignTemplateDto | null>(null);

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideEmail, setOverrideEmail] = useState("");
  const [overrideTemplateId, setOverrideTemplateId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const eligibleTemplates: CampaignTemplateDto[] = templatesQuery.data?.data ?? [];
  const rules: CampaignRuleDto[] = (rulesQuery.data?.data ?? []).slice().sort((a: CampaignRuleDto, b: CampaignRuleDto) => a.priority - b.priority);
  const overrides: CampaignRecipientOverrideDto[] = overridesQuery.data?.data ?? [];

  // Mutations
  const addTemplateMutation = useMutation({
    mutationFn: (body: { templateId: string; isFallback?: boolean }) =>
      api.post(`/api/campaigns/${campaign.id}/templates`, body),
    onSuccess: async () => {
      await refreshAll();
      setAddTemplateOpen(false);
      setSelectedNewTemplateId("");
      setIsNewTemplateFallback(false);
      toast.success("Template added to campaign");
    },
    onError: (err) => toast.error("Could not add template", errorMessage(err)),
  });

  const removeTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      api.delete(`/api/campaigns/${campaign.id}/templates/${templateId}`),
    onSuccess: async () => {
      await refreshAll();
      setDeleteTemplateTarget(null);
      toast.success("Template removed");
    },
    onError: (err) => toast.error("Could not remove template", errorMessage(err)),
  });

  const saveRuleMutation = useMutation({
    mutationFn: (body: unknown) => {
      if (editingRule) {
        return api.put(`/api/campaigns/${campaign.id}/rules/${editingRule.id}`, body);
      }
      return api.post(`/api/campaigns/${campaign.id}/rules`, body);
    },
    onSuccess: async () => {
      await refreshAll();
      setRuleModalOpen(false);
      setEditingRule(null);
      toast.success(editingRule ? "Targeting rule updated" : "Targeting rule created");
    },
    onError: (err) => toast.error("Could not save rule", errorMessage(err)),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) =>
      api.delete(`/api/campaigns/${campaign.id}/rules/${ruleId}`),
    onSuccess: async () => {
      await refreshAll();
      setDeleteRuleTarget(null);
      toast.success("Targeting rule deleted");
    },
    onError: (err) => toast.error("Could not delete rule", errorMessage(err)),
  });

  const addOverrideMutation = useMutation({
    mutationFn: (body: { contactId: string; templateId: string; reason?: string }) =>
      api.post(`/api/campaigns/${campaign.id}/overrides`, body),
    onSuccess: async () => {
      await refreshAll();
      setOverrideModalOpen(false);
      setOverrideEmail("");
      setOverrideTemplateId("");
      setOverrideReason("");
      toast.success("Recipient override added");
    },
    onError: (err) => toast.error("Could not add override", errorMessage(err)),
  });

  const removeOverrideMutation = useMutation({
    mutationFn: (contactId: string) =>
      api.delete(`/api/campaigns/${campaign.id}/overrides/${contactId}`),
    onSuccess: async () => {
      await refreshAll();
      toast.success("Override removed");
    },
    onError: (err) => toast.error("Could not remove override", errorMessage(err)),
  });

  const openAddRuleModal = () => {
    setEditingRule(null);
    setRuleForm({
      templateId: eligibleTemplates[0]?.templateId ?? campaign.template.id,
      priority: rules.length + 1,
      description: "",
      hotelSegment: "",
      contactPersona: "",
      city: "",
      requiresVerified: false,
      minConfidence: "",
    });
    setRuleModalOpen(true);
  };

  const openEditRuleModal = (rule: CampaignRuleDto) => {
    setEditingRule(rule);
    setRuleForm({
      templateId: rule.templateId,
      priority: rule.priority,
      description: rule.description ?? "",
      hotelSegment: rule.hotelSegment ?? "",
      contactPersona: rule.contactPersona ?? "",
      city: rule.city ?? "",
      requiresVerified: rule.requiresVerified,
      minConfidence: rule.minConfidence !== null && rule.minConfidence !== undefined ? String(rule.minConfidence) : "",
    });
    setRuleModalOpen(true);
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleForm.templateId) {
      toast.error("Template required", "Select a template for this rule.");
      return;
    }

    const payload = {
      templateId: ruleForm.templateId,
      priority: Number(ruleForm.priority) || 1,
      description: ruleForm.description.trim() || undefined,
      hotelSegment: (ruleForm.hotelSegment || undefined) as HotelSegment | undefined,
      contactPersona: (ruleForm.contactPersona || undefined) as ContactPersona | undefined,
      city: ruleForm.city.trim() || undefined,
      requiresVerified: Boolean(ruleForm.requiresVerified),
      minConfidence: ruleForm.minConfidence ? Number(ruleForm.minConfidence) : undefined,
    };

    saveRuleMutation.mutate(payload);
  };

  // Find contacts in list for override dialog lookup
  const contactsQuery = useQuery({
    queryKey: ["campaign-list-contacts", campaign.list.id],
    queryFn: () => api.get<any[]>(`/api/contacts?listId=${campaign.list.id}&pageSize=100`),
    enabled: overrideModalOpen,
  });

  const listContacts = contactsQuery.data?.data ?? [];

  const handleSaveOverride = (e: React.FormEvent) => {
    e.preventDefault();
    const contact = listContacts.find(
      (c) => c.email.toLowerCase() === overrideEmail.trim().toLowerCase() || c.id === overrideEmail
    );
    if (!contact) {
      toast.error("Contact not found", "Select an existing contact from this campaign's list.");
      return;
    }
    if (!overrideTemplateId) {
      toast.error("Template required", "Choose an eligible template.");
      return;
    }

    addOverrideMutation.mutate({
      contactId: contact.id,
      templateId: overrideTemplateId,
      reason: overrideReason.trim() || undefined,
    });
  };

  // Available templates in workspace not yet added to campaign
  const availableWorkspaceTemplates = (workspaceTemplates.data?.data ?? []).filter(
    (wt) => !eligibleTemplates.some((et: CampaignTemplateDto) => et.templateId === wt.id)
  );

  return (
    <div className="space-y-6">
      {readOnly && (
        <Callout tone="info" title="Templates & Rules Locked">
          This campaign has been approved or started. Targeting rules and template assignments are immutable to ensure reproducibility.
        </Callout>
      )}

      {/* 1. Eligible Templates Section */}
      <Panel
        title="Eligible Templates"
        description="Templates available to be matched and sent in this campaign. One template serves as the default fallback."
        actions={
          !readOnly && (
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setSelectedNewTemplateId(availableWorkspaceTemplates[0]?.id ?? "");
                setIsNewTemplateFallback(false);
                setAddTemplateOpen(true);
              }}
              disabled={availableWorkspaceTemplates.length === 0}
            >
              Add Template
            </Button>
          )
        }
      >
        <div className="divide-y divide-line rounded-lg border border-line">
          {eligibleTemplates.map((t: CampaignTemplateDto) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-4 p-4 text-[13px] hover:bg-surface-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{t.name}</span>
                  {t.isFallback ? (
                    <Badge tone="brand">
                      <Star className="h-3 w-3 fill-current" /> Fallback
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Eligible</Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-ink-subtle truncate">
                  Subject: {t.subject}
                </div>
              </div>

              {!readOnly && (
                <div className="flex items-center gap-2 shrink-0">
                  {!t.isFallback && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        addTemplateMutation.mutate({
                          templateId: t.templateId,
                          isFallback: true,
                        })
                      }
                      title="Make this the default fallback template when no rules match"
                    >
                      Make Fallback
                    </Button>
                  )}
                  {eligibleTemplates.length > 1 && (
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setDeleteTemplateTarget(t)}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* 2. Targeting Rules Section */}
      <Panel
        title="Targeting Rules"
        description="Rules are evaluated in order of priority (1 = highest). The first matching rule assigns its template to the recipient."
        actions={
          !readOnly && (
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="h-4 w-4" />}
              onClick={openAddRuleModal}
            >
              Add Rule
            </Button>
          )
        }
      >
        {rules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-6 text-center">
            <Split className="mx-auto h-8 w-8 text-ink-faint" />
            <p className="mt-2 text-sm font-medium text-ink">No targeting rules defined</p>
            <p className="mt-1 text-xs text-ink-subtle">
              All recipients will receive the fallback template unless targeted rules are added.
            </p>
            {!readOnly && (
              <Button size="sm" className="mt-4" onClick={openAddRuleModal}>
                Create first rule
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {rules.map((rule: CampaignRuleDto) => (
              <div
                key={rule.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 text-[13px] hover:bg-surface-muted/30 transition-colors"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center justify-center rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
                      Priority #{rule.priority}
                    </span>
                    <span className="font-medium text-ink">
                      {rule.description || `Rule #${rule.priority}`}
                    </span>
                    <span className="text-ink-faint">→</span>
                    <span className="font-semibold text-brand-ink">
                      {rule.templateName}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                    {rule.hotelSegment && (
                      <Badge tone="info">
                        Segment: {HOTEL_SEGMENT_LABELS[rule.hotelSegment as HotelSegment] ?? rule.hotelSegment}
                      </Badge>
                    )}
                    {rule.contactPersona && (
                      <Badge tone="info">
                        Persona: {CONTACT_PERSONA_LABELS[rule.contactPersona as ContactPersona] ?? rule.contactPersona}
                      </Badge>
                    )}
                    {rule.city && (
                      <Badge tone="neutral">City: {rule.city}</Badge>
                    )}
                    {rule.requiresVerified && (
                      <Badge tone="success" dot>
                        <ShieldCheck className="h-3 w-3" /> Verified only
                      </Badge>
                    )}
                    {rule.minConfidence !== null && rule.minConfidence !== undefined && (
                      <Badge tone="neutral">Min Conf: {Math.round(rule.minConfidence * 100)}%</Badge>
                    )}
                    {!rule.hotelSegment && !rule.contactPersona && !rule.city && (
                      <span className="italic text-ink-faint">Matches any recipient</span>
                    )}
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Edit2 className="h-3.5 w-3.5" />}
                      onClick={() => openEditRuleModal(rule)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => setDeleteRuleTarget(rule)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* 3. Manual Recipient Overrides Section */}
      <Panel
        title="Manual Recipient Overrides"
        description="Manually override template assignment for specific contacts. Overrides take precedence over all rules."
        actions={
          !readOnly && (
            <Button
              size="sm"
              icon={<UserCheck className="h-4 w-4" />}
              onClick={() => {
                setOverrideEmail("");
                setOverrideTemplateId(eligibleTemplates[0]?.templateId ?? campaign.template.id);
                setOverrideReason("");
                setOverrideModalOpen(true);
              }}
            >
              Add Override
            </Button>
          )
        }
      >
        {overrides.length === 0 ? (
          <p className="text-xs text-ink-subtle italic">No manual recipient overrides configured.</p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {overrides.map((ov: CampaignRecipientOverrideDto) => (
              <div
                key={ov.id}
                className="flex items-center justify-between gap-4 p-3 text-[13px] hover:bg-surface-muted/30 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{ov.contactEmail}</span>
                    <span className="text-ink-faint">→</span>
                    <Badge tone="brand">{ov.templateName}</Badge>
                  </div>
                  {ov.reason && <p className="text-xs text-ink-subtle mt-0.5">{ov.reason}</p>}
                </div>
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => removeOverrideMutation.mutate(ov.contactId)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Add Eligible Template Dialog */}
      <Dialog
        open={addTemplateOpen}
        onClose={() => setAddTemplateOpen(false)}
        title="Add eligible template to campaign"
        description="Make this template available for rules and targeting in this campaign."
        footer={
          <>
            <Button onClick={() => setAddTemplateOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!selectedNewTemplateId}
              loading={addTemplateMutation.isPending}
              onClick={() =>
                addTemplateMutation.mutate({
                  templateId: selectedNewTemplateId,
                  isFallback: isNewTemplateFallback,
                })
              }
            >
              Add to Campaign
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <SelectField
            label="Template"
            value={selectedNewTemplateId}
            onChange={(e) => setSelectedNewTemplateId(e.target.value)}
            options={availableWorkspaceTemplates.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Select a template"
          />
          <Checkbox
            label="Set as fallback template"
            description="If checked, this template will be assigned when no other rules match."
            checked={isNewTemplateFallback}
            onChange={(e) => setIsNewTemplateFallback(e.target.checked)}
          />
        </div>
      </Dialog>

      {/* Add / Edit Targeting Rule Dialog */}
      <Dialog
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={editingRule ? "Edit Targeting Rule" : "Add Targeting Rule"}
        description="Configure conditions that recipients must meet to be assigned this template."
        footer={
          <>
            <Button onClick={() => setRuleModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSaveRule}
              loading={saveRuleMutation.isPending}
            >
              {editingRule ? "Update Rule" : "Create Rule"}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveRule} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Assigned Template"
              value={ruleForm.templateId}
              onChange={(e) => setRuleForm({ ...ruleForm, templateId: e.target.value })}
              options={eligibleTemplates.map((t: CampaignTemplateDto) => ({
                value: t.templateId,
                label: `${t.name}${t.isFallback ? " (Fallback)" : ""}`,
              }))}
            />
            <TextField
              label="Evaluation Priority"
              type="number"
              min={1}
              value={String(ruleForm.priority)}
              onChange={(e) => setRuleForm({ ...ruleForm, priority: parseInt(e.target.value, 10) || 1 })}
              hint="1 is evaluated first"
            />
          </div>

          <TextField
            label="Rule Description / Name"
            optional
            value={ruleForm.description}
            onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
            placeholder="e.g. Luxury Boutique GMs"
          />

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Target Hotel Segment"
              optional
              value={ruleForm.hotelSegment}
              onChange={(e) => setRuleForm({ ...ruleForm, hotelSegment: e.target.value })}
              options={[
                { value: "", label: "Any hotel segment" },
                ...HOTEL_SEGMENTS.map((seg) => ({
                  value: seg,
                  label: HOTEL_SEGMENT_LABELS[seg],
                })),
              ]}
            />
            <SelectField
              label="Target Contact Persona"
              optional
              value={ruleForm.contactPersona}
              onChange={(e) => setRuleForm({ ...ruleForm, contactPersona: e.target.value })}
              options={[
                { value: "", label: "Any persona" },
                ...CONTACT_PERSONAS.map((per) => ({
                  value: per,
                  label: CONTACT_PERSONA_LABELS[per],
                })),
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="City Match"
              optional
              value={ruleForm.city}
              onChange={(e) => setRuleForm({ ...ruleForm, city: e.target.value })}
              placeholder="e.g. Mumbai, Goa"
            />
            <TextField
              label="Min Confidence (0.00 - 1.00)"
              optional
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={ruleForm.minConfidence}
              onChange={(e) => setRuleForm({ ...ruleForm, minConfidence: e.target.value })}
              placeholder="e.g. 0.75"
            />
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
            <Checkbox
              label="Requires Verified Data Only"
              description="Do not treat unverified or guessed classifications as facts. Contacts with unverified estimates will be skipped by this rule."
              checked={ruleForm.requiresVerified}
              onChange={(e) => setRuleForm({ ...ruleForm, requiresVerified: e.target.checked })}
            />
          </div>
        </form>
      </Dialog>

      {/* Delete Rule Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteRuleTarget)}
        onClose={() => setDeleteRuleTarget(null)}
        onConfirm={() => deleteRuleTarget && deleteRuleMutation.mutate(deleteRuleTarget.id)}
        loading={deleteRuleMutation.isPending}
        title="Delete targeting rule?"
        description={`Are you sure you want to delete ${deleteRuleTarget?.description || `Rule #${deleteRuleTarget?.priority}`}?`}
        confirmLabel="Delete Rule"
      />

      {/* Delete Template Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTemplateTarget)}
        onClose={() => setDeleteTemplateTarget(null)}
        onConfirm={() => deleteTemplateTarget && removeTemplateMutation.mutate(deleteTemplateTarget.templateId)}
        loading={removeTemplateMutation.isPending}
        title="Remove template from campaign?"
        description={`Remove "${deleteTemplateTarget?.name}"? Targeting rules referencing this template will also be deleted.`}
        confirmLabel="Remove Template"
      />

      {/* Add Recipient Override Dialog */}
      <Dialog
        open={overrideModalOpen}
        onClose={() => setOverrideModalOpen(false)}
        title="Add Recipient Override"
        description="Assign a specific template to a recipient regardless of targeting rules."
        footer={
          <>
            <Button onClick={() => setOverrideModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSaveOverride}
              loading={addOverrideMutation.isPending}
            >
              Save Override
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveOverride} className="space-y-4">
          <SelectField
            label="Recipient in List"
            value={overrideEmail}
            onChange={(e) => setOverrideEmail(e.target.value)}
            options={listContacts.map((c) => ({
              value: c.email,
              label: `${c.email} (${c.name || "No name"})`,
            }))}
            placeholder={contactsQuery.isPending ? "Loading contacts..." : "Select a recipient"}
          />

          <SelectField
            label="Assigned Template"
            value={overrideTemplateId}
            onChange={(e) => setOverrideTemplateId(e.target.value)}
            options={eligibleTemplates.map((t: CampaignTemplateDto) => ({
              value: t.templateId,
              label: t.name,
            }))}
          />

          <TextField
            label="Reason"
            optional
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="e.g. Requested VIP custom proposal"
          />
        </form>
      </Dialog>
    </div>
  );
}
