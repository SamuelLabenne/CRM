// Starter layouts offered when creating a new template or broadcast.

export type EmailStarter = { id: string; name: string; description: string; subject: string; preheader: string; html: string };

export const EMAIL_STARTERS: EmailStarter[] = [
  {
    id: "announcement",
    name: "Announcement",
    description: "Share news with one clear call to action.",
    subject: "Big news from {{workspace.name}}",
    preheader: "A quick update we think you'll like",
    html: `<h1>Hi {{contact.first_name | "there"}}, we have news</h1>
<p>Write a short, friendly introduction here. Tell people what is new and why it matters to them.</p>
<ul><li>Highlight the first benefit</li><li>Highlight the second benefit</li><li>Highlight the third benefit</li></ul>
<p><a data-button href="https://example.com">Learn more</a></p>
<p>Thanks,<br>The {{workspace.name}} team</p>`,
  },
  {
    id: "event-invite",
    name: "Event invitation",
    description: "Invite contacts to a webinar, workshop or meetup.",
    subject: "You're invited: {{event.title}}",
    preheader: "{{event.date}} at {{event.time}}",
    html: `<h1>Join us for {{event.title}}</h1>
<p>Hi {{contact.first_name | "there"}}, we'd love to see you at our next event.</p>
<p><strong>When:</strong> {{event.date}}, {{event.time}}<br><strong>Where:</strong> {{event.location}}</p>
<p>{{event.description}}</p>
<p><a data-button href="https://example.com/register">Save my spot</a></p>`,
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "A simple multi-section update.",
    subject: "What's new this month",
    preheader: "Our latest news, tips and events",
    html: `<h1>This month at {{workspace.name}}</h1>
<p>Hi {{contact.first_name | "there"}}, here is what we've been up to.</p>
<h2>Headline story</h2>
<p>Summarise your main story in two or three sentences, then link to the full article.</p>
<p><a href="https://example.com/story">Read the full story</a></p>
<hr>
<h2>Quick tips</h2>
<ol><li>First tip</li><li>Second tip</li><li>Third tip</li></ol>
<hr>
<p>Have a question? Just reply to this email.</p>`,
  },
  {
    id: "thank-you",
    name: "Thank you",
    description: "Follow up after an event or purchase.",
    subject: "Thank you, {{contact.first_name | \"friend\"}}",
    preheader: "We appreciate you",
    html: `<h1>Thank you!</h1>
<p>Hi {{contact.first_name | "there"}}, thanks for spending time with us. We hope it was useful.</p>
<p>If you have questions or feedback, hit reply. We read every message.</p>
<p><a data-button href="https://example.com/feedback">Share feedback</a></p>`,
  },
];
