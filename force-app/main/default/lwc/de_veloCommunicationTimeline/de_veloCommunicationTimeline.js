import { LightningElement, api } from "lwc";

// Placeholder omni-channel activity for the demo.
const EVENTS = [
  { id: 1, channel: "Human Call", icon: "utility:call", cls: "accent", title: "Test drive coordination", desc: "Dev Mehta locked Sat 11 AM slot", when: "Today · 2:10 PM" },
  { id: 2, channel: "AI Call", icon: "utility:einstein", cls: "ai", title: "Velo Orion X7 follow-up", desc: "Confirmed Summit L diesel AT interest", when: "Today · 11:24 AM" },
  { id: 3, channel: "WhatsApp", icon: "utility:chat", cls: "pos", title: "Price & brochure shared", desc: "On-road quote + exchange estimate sent", when: "Today · 9:05 AM" },
  { id: 4, channel: "Email", icon: "utility:email", cls: "info", title: "Velo Orion X7 brochure", desc: "Opened · clicked 'Book test drive'", when: "Yesterday · 7:20 PM" },
  { id: 5, channel: "AI Call", icon: "utility:einstein", cls: "ai", title: "Finance options query", desc: "Requested finance specialist callback", when: "Yesterday · 6:48 PM" },
  { id: 6, channel: "Web", icon: "utility:world", cls: "muted", title: "Configured Velo Orion X7", desc: "Built Summit L on velomotors.example", when: "13 Sep · 8:40 PM" },
  { id: 7, channel: "Web Form", icon: "utility:form", cls: "muted", title: "Website enquiry submitted", desc: "Source of this lead", when: "12 Sep · 10:02 AM" }
];

export default class De_veloCommunicationTimeline extends LightningElement {
  @api recordId;

  get events() {
    return EVENTS.map((e, i) => ({
      ...e,
      dotClass: `dot dot--${e.cls}`,
      last: i === EVENTS.length - 1
    }));
  }

  get total() { return EVENTS.length; }
  get lastContact() { return EVENTS[0].when; }

  get channelStats() {
    const counts = {};
    EVENTS.forEach((e) => { counts[e.channel] = (counts[e.channel] || 0) + 1; });
    return Object.keys(counts).map((k) => ({ id: k, label: k, count: counts[k] }));
  }
}