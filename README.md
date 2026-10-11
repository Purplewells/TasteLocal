## 1. Concept
An app that connects users (offices, expatriates, and locals) to vendors specialising in local dishes. This app would :

- Showcase popular local dishes.
- Allow users to order meals for delivery to their workplace or home.
- Emphasise the cultural and authentic nature of the food.
- Feature reviews, ratings, and vendor profiles to build trust.
- Offer pre-ordering for busy locations or large office deliveries.

### 🧑‍🤝‍🧑Target Audience
- Office Workers: Convenient lunch options for busy professionals.
- Expatriates: Introducing foreigners to authentic local cuisine.
- Locals: Easy access to their favourite meals without visiting physical vendors.

### 🤷‍♀️ Unique Selling Points (USP)
- Focus on authentic local dishes.
- Highlight trusted local vendors with detailed profiles.
- Include multi-language support for expatriates.
- Cultural storytelling: Highlight the history and preparation process of each dish.
- Bulk delivery options for group orders at offices or events.

## 2. Key Features
#### User Features:

- Ability to browse local dishes categorised by type (e.g., Waakye, Fufu, Banku).
- Search for vendors by location or dish.
- Have real-time tracking of delivery.
- Payment options: Mobile money, credit cards, and cash on delivery.
- User reviews and ratings for vendors.

#### Vendor Features:

- Vendor dashboard to manage orders.
- Upload photos and descriptions of their dishes.
- Define delivery areas and times.
- Analytics on sales and customer reviews.

### Admin Features:
- As an admin, I want to be able to manage users and vendors.
- Have the ability to monitor transactions and disputes.
- Promote featured vendors or dishes.

### Cultural Add-ons:
- Educational content about the dishes (e.g., history of Waakye).
- Pairing suggestions (e.g., beverages that go well with Fufu).

## 3: Data Sources
#### Vendor and Menu Data
The intent is to partner with local food vendors and collect:
- Vendor names and locations.
- Menu information, including prices and photos.
- Delivery areas and times
- Use Google Maps scraper to gather initial data
- Build on user-generated content
#### User Data
- User profiles with location preferences.
- Order history for personalised recommendations.
#### Cultural Data
- Research local cuisines and their origins to enhance the app content.
- Collaborate with food bloggers or cultural experts.
- Geolocation Data
- Use Google Maps API or OpenStreetMap for:
- Vendor location mapping.
-  Delivery route optimisation.
#### Payment Integration
- Mobile Money APIs (e.g., MTN Mobile Money, Vodafone Cash).
- Payment gateways like Flutterwave or Paystack for card payments.

## 4. Staff Task Manager

A small internal tool for assigning and tracking recurring staff tasks.

- **Task library**: reusable task definitions (title, category, instructions).
- **Staff**: people who can be assigned work.
- **Schedules**: assign a library task to a staff member, once or on a daily, weekly or monthly repeat.
- **Task instances**: generated automatically from each schedule (up to 7 days ahead). Staff open their work queue, set a status (open, in progress, completed, partially completed, not completed) and add notes. Unfinished instances past their due time are flagged as overdue.

### Running it

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
npm start            # http://localhost:3000 (set PORT to change)
npm test             # unit and API tests
```

Data is stored in `data/db.json` (override with `DATA_FILE`). The scheduler checks for due occurrences every minute and whenever a schedule is created or resumed.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/staff` | List or add staff |
| GET/POST | `/api/templates` | List or add library tasks |
| PATCH/DELETE | `/api/templates/:id` | Edit or delete a library task (delete is refused while schedules use it) |
| GET/POST | `/api/schedules` | List schedules, or assign a task and generate its instances |
| PATCH/DELETE | `/api/schedules/:id` | Pause/resume (`{"active": true|false}`) or delete a schedule |
| GET | `/api/instances?staffId=&status=` | Work queue, sorted by due date |
| PATCH | `/api/instances/:id` | Set `status` and/or `notes` |
