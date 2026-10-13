// Reference data used by contact forms, filters and pickers (stages, owners, tags, custom fields).
import { asc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { tags, users } from "@/lib/db/schema";
import { getStages } from "@/lib/settings";
import { listCustomFieldDefs } from "@/lib/contacts/custom-fields";
import type { StageDTO, TagDTO, UserDTO } from "@/lib/contacts/dto";

export async function loadReferenceData() {
  const [stages, userRows, tagRows, customFields] = await Promise.all([
    getStages(),
    db.select({ id: users.id, name: users.name, color: users.color }).from(users).where(isNull(users.deactivatedAt)).orderBy(asc(users.name)),
    db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).orderBy(asc(tags.name)),
    listCustomFieldDefs(),
  ]);
  return {
    stages: stages as StageDTO[],
    users: userRows as UserDTO[],
    tags: tagRows as TagDTO[],
    customFields,
  };
}
