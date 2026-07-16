import { z } from "zod";
import { slotHashing } from "../utils";

// "HH:MM" and accepts from 00:00 to 24:00
const Time = z
  .string()
  .regex(/^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/, "time must be HH:MM");

const intervalFields = { start: Time, end: Time };

//start of a boocked type/schedule needs to be smaller then end
const startBeforeEnd = (i: { start: string; end: string }) =>
  slotHashing(i.start) < slotHashing(i.end);

//validate on each input that inherit intervalFielad
export const IntervalSchema = z
  .object(intervalFields)
  .refine(startBeforeEnd, "start must be before end");

export const AvailableScheduleSchema = z
  .object({ ...intervalFields, canDoSchedule: z.literal(true) })
  .refine(startBeforeEnd, "start must be before end");

export const BlockedScheduleSchema = z
  .object({ ...intervalFields, canDoSchedule: z.literal(false) })
  .refine(startBeforeEnd, "start must be before end");

// schedule per location can be at least 1 at most 2
// If it is one is mandatory to be when the user is available
// If both are pressent it dosen t matter
export const SchedulesSchema = z.union([
  z.tuple([AvailableScheduleSchema]),
  z.tuple([AvailableScheduleSchema, BlockedScheduleSchema]),
  z.tuple([BlockedScheduleSchema, AvailableScheduleSchema]),
]);

export const LocationDispoibilitySchema = z.object({
  locationId: z.string().min(1),
  schedules: SchedulesSchema,
  bookedIntervals: z.array(IntervalSchema),
});

export const BookingSchema = z.record(
  z.string().min(1),
  z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    z.array(LocationDispoibilitySchema)
  )
);

// a slot check needs a start plus at least one bound: an explicit end or a duration
// when both are present end wins
export const CheckSlotSchema = z
  .object({
    resourceId: z.string().min(1),
    locationId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    start: Time,
    end: Time.optional(),
    duration: z.number().int().positive().optional(),
  })
  .refine(
    (s) => s.end !== undefined || s.duration !== undefined,
    "either end or duration must be provided"
  )
  .refine(
    (s) => s.end === undefined || startBeforeEnd({ start: s.start, end: s.end }),
    "start must be before end"
  );

export type Interval = z.infer<typeof IntervalSchema>;
export type CheckSlot = z.infer<typeof CheckSlotSchema>;
export type AvailableSchedule = z.infer<typeof AvailableScheduleSchema>;
export type BlockedSchedule = z.infer<typeof BlockedScheduleSchema>;
export type Schedule = AvailableSchedule | BlockedSchedule;
export type Schedules = z.infer<typeof SchedulesSchema>;
export type LocationDispoibility = z.infer<typeof LocationDispoibilitySchema>;
export type Booking = z.infer<typeof BookingSchema>;
