export type SourceTabValidationResult =
  | { readonly kind: "valid"; readonly tabId: number }
  | { readonly kind: "invalid" };

export interface SourceTabValidator {
  validate(): Promise<SourceTabValidationResult>;
}

export interface SourceTabLifecycle extends SourceTabValidator {
  subscribe(listener: () => void): () => void;
}
