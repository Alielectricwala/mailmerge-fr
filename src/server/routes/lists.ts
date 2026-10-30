// Contact lists and membership
import { Router } from "express";
import prisma from "../db.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { audit } from "../lib/audit.js";
import { ok } from "../lib/http.js";
import { toListDto } from "../lib/serialize.js";
import { ContactListInputSchema, IdSchema, ListMembersInputSchema } from "../../shared/types.js";

const router = Router();
const withCount = { _count: { select: { members: true } } } as const;

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const lists = await prisma.contactList.findMany({ orderBy: { name: "asc" }, include: withCount });
    ok(res, lists.map(toListDto));
  })
);

router.post(
  "/",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const input = ContactListInputSchema.parse(req.body);
    const list = await prisma.contactList.create({ data: input, include: withCount });
    await audit(req, { action: "list.create", entityType: "ContactList", entityId: list.id, metadata: { name: list.name } });
    ok(res, toListDto(list), 201);
  })
);

router.patch(
  "/:id",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const input = ContactListInputSchema.partial().parse(req.body);
    const list = await prisma.contactList.update({ where: { id }, data: input, include: withCount });
    ok(res, toListDto(list));
  })
);

router.delete(
  "/:id",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const campaigns = await prisma.campaign.count({ where: { contactListId: id } });
    if (campaigns > 0) {
      throw AppError.conflict("LIST_IN_USE", `This list is used by ${campaigns} campaign${campaigns === 1 ? "" : "s"}, so it can't be deleted. Contacts stay in FocusRealm either way.`);
    }
    const list = await prisma.contactList.delete({ where: { id } });
    await audit(req, { action: "list.delete", entityType: "ContactList", entityId: id, metadata: { name: list.name } });
    ok(res, { id });
  })
);

router.post(
  "/:id/members",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const { contactIds } = ListMembersInputSchema.parse(req.body);
    const list = await prisma.contactList.findUnique({ where: { id } });
    if (!list) throw AppError.notFound("LIST_NOT_FOUND", "That list no longer exists.");
    const { count } = await prisma.listMembership.createMany({
      data: contactIds.map((contactId) => ({ contactId, contactListId: id })),
      skipDuplicates: true,
    });
    await audit(req, { action: "list.add_members", entityType: "ContactList", entityId: id, metadata: { name: list.name, added: count } });
    ok(res, { added: count, alreadyMembers: contactIds.length - count });
  })
);

router.post(
  "/:id/members/remove",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const { contactIds } = ListMembersInputSchema.parse(req.body);
    const { count } = await prisma.listMembership.deleteMany({ where: { contactListId: id, contactId: { in: contactIds } } });
    await audit(req, { action: "list.remove_members", entityType: "ContactList", entityId: id, metadata: { removed: count } });
    ok(res, { removed: count });
  })
);

export default router;
