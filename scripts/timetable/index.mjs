/**
 * Fimblewood Academy — Timetable
 *
 * A GM-authored weekly class schedule for the Academy's PCs, viewable one
 * week at a time (this week / next week) by everyone. Slots into the
 * Fimblewood control category the same way Jukebox/Dragonchess do (see
 * draw.mjs's CONTROL_GROUP): a "Timetable" tool for everyone, plus a
 * GM-only "Timetable Editor" tool.
 *
 * Hard-requires Simple Calendar Reborn: which of the two week buffers
 * counts as "this week" is derived from its current in-game date (see
 * calendar.mjs), so without it there's no way to know which week is which.
 */

import { CONTROL_GROUP } from "../draw.mjs";
import { isCalendarAvailable, onDateChange } from "./calendar.mjs";
import { registerTimetableData, onScheduleChange } from "./data.mjs";

let _viewer = null;
let _editor = null;

function warnNoCalendar() {
  ui.notifications.error(game.i18n.localize("FIMBLEWOOD.Timetable.RequiresCalendar"));
}

export async function openTimetableViewer() {
  if (!isCalendarAvailable()) return warnNoCalendar();
  const { TimetableViewerApp } = await import("./viewer-app.mjs");
  if (!_viewer || !_viewer.rendered) {
    _viewer = new TimetableViewerApp();
    _viewer.render(true);
  } else {
    _viewer.bringToTop();
  }
}

export async function openTimetableEditor() {
  if (!game.user.isGM) return;
  if (!isCalendarAvailable()) return warnNoCalendar();
  const { TimetableEditorApp } = await import("./editor-app.mjs");
  if (!_editor || !_editor.rendered) {
    _editor = new TimetableEditorApp();
    _editor.render(true);
  } else {
    _editor.bringToTop();
  }
}

function rerenderOpenWindows() {
  if (_viewer?.rendered) _viewer.render();
  if (_editor?.rendered) _editor.render();
}

export function registerTimetable() {
  registerTimetableData();
  onScheduleChange(rerenderOpenWindows);

  Hooks.on("getSceneControlButtons", (controls) => {
    const group = controls[CONTROL_GROUP];
    if (!group) return;

    group.tools.timetable = {
      name: "timetable",
      title: game.i18n.localize("FIMBLEWOOD.Timetable.ButtonTitle"),
      icon: "fas fa-calendar-week",
      button: true, visible: true, order: 5,
      onChange: () => openTimetableViewer()
    };
    if (game.user.isGM) {
      group.tools.timetableEditor = {
        name: "timetableEditor",
        title: game.i18n.localize("FIMBLEWOOD.Timetable.EditorButtonTitle"),
        icon: "fas fa-calendar-pen",
        button: true, visible: true, order: 6,
        onChange: () => openTimetableEditor()
      };
    }
  });

  Hooks.once("ready", () => {
    if (!isCalendarAvailable()) {
      console.warn("fimblewood-academy | Timetable requires Simple Calendar Reborn to be active; its scene-control buttons will show a warning until it is.");
    }
    onDateChange(rerenderOpenWindows);
  });
}
