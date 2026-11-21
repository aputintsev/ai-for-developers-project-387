import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Календарь звонков" })
namespace CallCalendar;

model MeetingType {
  id: string;
  @minLength(1) name: string;
  @minLength(1) description: string;
  @minValue(1) @maxValue(480) durationMinutes: int32;
}

@get
@route("/api/meeting-types")
@operationId("listMeetingTypes")
op listMeetingTypes(): MeetingType[];

model CreateMeetingTypeInput is OmitProperties<MeetingType, "id">;

model MeetingTypeCreated {
  @statusCode statusCode: 201;
  @body meetingType: MeetingType;
}

@error
model MeetingTypeValidationError {
  @statusCode statusCode: 400;
  @body error: {
    message: string;
    fieldErrors: {
      name?: string;
      description?: string;
      durationMinutes?: string;
    };
  };
}

@error
model MeetingTypeNameConflict {
  @statusCode statusCode: 409;
  @body error: {
    message: string;
    fieldErrors: {
      name: string;
    };
  };
}

@post
@route("/api/meeting-types")
@operationId("createMeetingType")
op createMeetingType(@body input: CreateMeetingTypeInput):
  MeetingTypeCreated | MeetingTypeValidationError | MeetingTypeNameConflict;

model Slot {
  start: utcDateTime;
  end: utcDateTime;
}

model Availability {
  timeZone: "Europe/Moscow";
  slots: Slot[];
}

@error
model AvailabilityDateError {
  @statusCode statusCode: 400;
  @body error: {
    message: string;
  };
}

@error
model AvailabilityMeetingTypeNotFound {
  @statusCode statusCode: 404;
  @body error: {
    message: string;
  };
}

@get
@route("/api/meeting-types/{meetingTypeId}/slots")
@operationId("listSlots")
op listSlots(@path meetingTypeId: string, @query date: plainDate):
  Availability | AvailabilityDateError | AvailabilityMeetingTypeNotFound;

model CreateBookingInput {
  meetingTypeId: string;
  start: utcDateTime;
  @minLength(1) guestName: string;
  @format("email") guestEmail: string;
}

model Booking extends Slot {
  id: string;
  meetingType: MeetingType;
  guestName: string;
  guestEmail: string;
}

model BookingCreated {
  @statusCode statusCode: 201;
  @header("Set-Cookie") guestProfileCookie?: string;
  @body booking: Booking;
}

@error
model BookingValidationError {
  @statusCode statusCode: 400;
  @body error: {
    message: string;
    fieldErrors: {
      meetingTypeId?: string;
      start?: string;
      guestName?: string;
      guestEmail?: string;
    };
  };
}

@error
model BookingTimeConflict {
  @statusCode statusCode: 409;
  @body error: {
    message: string;
  };
}

@post
@route("/api/bookings")
@operationId("createBooking")
op createBooking(@body input: CreateBookingInput, @cookie("calendarGuest") guestProfileKey?: string):
  BookingCreated | BookingValidationError | BookingTimeConflict;

@get
@route("/api/owner/bookings")
@operationId("listOwnerBookings")
op listOwnerBookings(): Booking[];

model GuestBooking is OmitProperties<Booking, "guestName" | "guestEmail">;

@get
@route("/api/guest/bookings")
@operationId("listGuestBookings")
op listGuestBookings(@cookie("calendarGuest") guestProfileKey?: string): GuestBooking[];
