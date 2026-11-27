# HobbyIndia

> An independent guide by Fuel Labs that points a person to the right official Indian government page for their problem. Not a government website, and not affiliated with the Government of India or any state government.

HobbyLM-Embed (a 140M-parameter embedding model, harims95/hobbylm-embed-140m) matches a question in English, Hinglish, Tanglish or Kanglish to one of 36 fixed service cards and 10 decision flows written by people. Nothing is generated. Every answer ends at an official government website.

## Use it for
- Finding the official page and the responsible authority for an Indian public service: passport, RTI, free legal aid, ration card, Udyam/MSME, PM-KISAN, scholarships, Aadhaar correction, certificates, pensions, EPFO, GST, FSSAI and more.

## Rules for agents
- Emergencies first: tell the person to call 112. Cyber fraud: call 1930 or report at https://cybercrime.gov.in/
- Never ask for, type or send Aadhaar, PAN, bank numbers, passwords or OTPs. The person does every sensitive step on the official site.
- The official website decides every case. This guide gives no legal, tax or financial advice.

## API
- POST /api/search with JSON {"q": "<question, up to 300 characters>"}. Returns {"emergency": bool, "covered": bool, "results": [{"id": "<card id>", "score": <0-1>}]}. Card text and official links are in the page bundle. Please keep requests light; there is a rate limit.

## Privacy
- Questions are not logged or stored. Numbers that look like Aadhaar, phone or PAN are removed before search.
