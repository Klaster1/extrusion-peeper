/** @typedef {import("../protocol.ts").SensorIcon} SensorIcon */

/**
 * The icons a readout can have, drawn on a 24×24 grid with the page's stroke
 * style.
 *
 * @type {Record<SensorIcon, { name: string; path: string }>}
 */
export const ICONS = {
  thermometer: {
    name: "Thermometer",
    path: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z M12 14v3",
  },
  droplet: {
    name: "Droplet",
    path: "M12 21a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 4.5 12 2c-.5 2.5-2 4.9-4 6.5S5 12 5 14a7 7 0 0 0 7 7Z",
  },
  chamber: {
    name: "Chamber",
    path: "M4 3h16v18H4Z M7 6h10v12H7Z M10 6v2.5h4V6 M12 8.5V10 M9 15h6",
  },
  ams: {
    name: "AMS",
    path: "M3 9h18v11H3Z M3 9l2-4h14l2 4 M7.5 12v5 M10.5 12v5 M13.5 12v5 M16.5 12v5",
  },
  printer: {
    name: "Printer",
    path: "M4 3h16v18H4Z M4 8h16 M10 8v3h4V8 M12 11v2 M7 17h10",
  },
  spool: {
    name: "Spool",
    path: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z M12 3h9",
  },
  none: { name: "None", path: "" },
};

/**
 * Draws the icon into an `<svg>`, or hides it for no icon.
 *
 * @param {SVGSVGElement} svg
 * @param {SensorIcon} icon
 */
export const drawIcon = (svg, icon) => {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[icon].path);
  svg.replaceChildren(path);
  svg.style.display = icon === "none" ? "none" : "";
};
