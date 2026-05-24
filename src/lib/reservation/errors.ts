/**
 * Typed errors thrown by the reservation service. Callers (server actions,
 * route handlers) translate these into user-facing messages.
 */

export class ReservationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ReservationError";
  }
}

export class SeatUnavailable extends ReservationError {
  constructor() {
    super("This seat is unavailable.", "SEAT_UNAVAILABLE");
  }
}

export class SeatNotFound extends ReservationError {
  constructor() {
    super("Seat not found.", "SEAT_NOT_FOUND");
  }
}

export class ReservationNotFound extends ReservationError {
  constructor() {
    super("Reservation not found.", "RESERVATION_NOT_FOUND");
  }
}

export class HoldExpired extends ReservationError {
  constructor() {
    super("Your hold has expired.", "HOLD_EXPIRED");
  }
}

export class IllegalState extends ReservationError {
  constructor(detail: string) {
    super(`Reservation is in an unexpected state: ${detail}`, "ILLEGAL_STATE");
  }
}

export class NotYourReservation extends ReservationError {
  constructor() {
    super("This reservation belongs to a different user.", "NOT_YOUR_RESERVATION");
  }
}
