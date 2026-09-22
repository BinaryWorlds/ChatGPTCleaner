export type ProtectedConversationIdsResult =
  | {
      readonly kind: "success";
      readonly protectedConversationIds: ReadonlySet<string>;
    }
  | { readonly kind: "invalid" };

export interface ProtectedConversationStore {
  loadProtectedConversationIds(): Promise<ProtectedConversationIdsResult>;
  saveProtectedConversationIds(
    protectedConversationIds: ReadonlySet<string>,
  ): Promise<void>;
}
