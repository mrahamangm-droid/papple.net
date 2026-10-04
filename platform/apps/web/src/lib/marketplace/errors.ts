/** Typed marketplace failures. Messages are generic on purpose: database text never reaches users. */
export class MarketplaceError extends Error {
  constructor(message = "Something went wrong. Please try again.") {
    super(message);
    this.name = "MarketplaceError";
  }
}
export class NotAllowedError extends MarketplaceError {
  constructor() { super("You are not allowed to do that."); this.name = "NotAllowedError"; }
}
export class InvalidInputError extends MarketplaceError {
  constructor() { super("Some of the information provided is not valid."); this.name = "InvalidInputError"; }
}
export class LimitError extends MarketplaceError {
  constructor() { super("A usage limit has been reached."); this.name = "LimitError"; }
}
export class DuplicateError extends MarketplaceError {
  constructor() { super("That already exists."); this.name = "DuplicateError"; }
}

/** Postgres error codes raised by the marketplace RPCs: 42501 not allowed, 22023 invalid, 54000 limit, 23505 duplicate. */
export function mapDbError(err: { code?: string; message?: string }): MarketplaceError {
  switch (err.code) {
    case "42501": return new NotAllowedError();
    case "22023": return new InvalidInputError();
    case "54000": return new LimitError();
    case "23505": return new DuplicateError();
    default: return new MarketplaceError();
  }
}
