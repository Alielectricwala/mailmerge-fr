// Intelligent Data Preparation definitions, guide specifications, and sample templates
// for Hotel Prospects, Co-Marketing Partners, and General Business Prospect lists.

export const PROSPECT_LIST_TYPES = ["HOTEL_PROSPECTS", "CO_MARKETING_PARTNERS", "GENERAL_BUSINESS"] as const;
export type ProspectListType = (typeof PROSPECT_LIST_TYPES)[number];

export interface ColumnGuideItem {
  name: string;
  mappedField: string;
  description: string;
  example: string;
  personalizationTag?: string;
  essential?: boolean;
}

export interface RemovableColumnItem {
  name: string;
  reason: string;
}

export interface ListTypePreparationGuide {
  type: ProspectListType;
  title: string;
  shortLabel: string;
  badgeTone: "brand" | "info" | "neutral";
  summary: string;
  sampleFileName: string;
  sampleCsv: string;
  essentialColumns: ColumnGuideItem[];
  recommendedColumns: ColumnGuideItem[];
  enrichmentColumns: ColumnGuideItem[];
  removableColumns: RemovableColumnItem[];
  personalizationTip: string;
}

export const LIST_PREPARATION_GUIDES: Record<ProspectListType, ListTypePreparationGuide> = {
  HOTEL_PROSPECTS: {
    type: "HOTEL_PROSPECTS",
    title: "Hotel Prospects",
    shortLabel: "Hotels & Resorts",
    badgeTone: "brand",
    summary:
      "Hotels, luxury resorts, boutique properties, hotel groups, and independent hospitality operators.",
    sampleFileName: "hotel-prospects-sample.csv",
    sampleCsv: `Hotel Name,Contact Person,Job Title,Contact Email,Hotel Website,City,Hotel Segment,Contact Persona,Number of Rooms,Facilities,Brand
The Oberoi Grand Palace,Aaditya Mehta,General Manager,aaditya.mehta@oberoihotels.test,https://oberoihotels.com,Kolkata,LUXURY,GENERAL_MANAGER,209,"Spa, Fine Dining, Banquet",Oberoi Hotels
The Postcard Cavelossim,Rohan Verma,Managing Director,rohan.verma@postcardhotels.test,https://postcardhotels.com,Goa,BOUTIQUE,OWNER_OPERATOR,18,"Ayurvedic Spa, Private Pools",The Postcard Hotel
Radisson Blu Plaza,Priya Sharma,Director of Operations,priya.sharma@radissonblu.test,https://radissonhotels.com,New Delhi,UPSCALE,OPERATIONS_DIRECTOR,261,"Executive Lounge, Conference Center",Radisson Hotel Group
Kumarakom Lake Resort,Kavita Nair,General Manager,kavita.nair@kumarakomresort.test,https://kumarakomlakeresort.in,Kumarakom,RESORT,GENERAL_MANAGER,65,"Villas, Houseboats, Ayurveda",Independent
Heritage Haveli Palace,Devendra Singh,Proprietor & Operator,devendra@rajasthanheritage.test,https://heritagehaveli.in,Udaipur,BOUTIQUE,OWNER_OPERATOR,24,"Rooftop Dining, Cultural Events",Independent`,
    essentialColumns: [
      {
        name: "Hotel Name",
        mappedField: "company",
        description: "The name of the hotel property or chain.",
        example: "The Postcard Cavelossim",
        personalizationTag: "{{company}}",
        essential: true,
      },
      {
        name: "Contact Email",
        mappedField: "email",
        description: "Direct or operational email address for outreach.",
        example: "rohan.verma@postcardhotels.test",
        essential: true,
      },
    ],
    recommendedColumns: [
      {
        name: "Contact Person",
        mappedField: "fullName",
        description: "Decision-maker's full name. Split into first and last name automatically.",
        example: "Rohan Verma",
        personalizationTag: "{{firstName}}",
      },
      {
        name: "Job Title",
        mappedField: "title",
        description: "Executive position at property or corporate office.",
        example: "General Manager",
        personalizationTag: "{{title}}",
      },
      {
        name: "Hotel Website",
        mappedField: "custom:website",
        description: "Official property URL used for research and verification.",
        example: "https://postcardhotels.com",
      },
      {
        name: "City",
        mappedField: "custom:city",
        description: "Property location city used to tailor localized references.",
        example: "Goa",
        personalizationTag: "{{city}}",
      },
      {
        name: "Hotel Segment",
        mappedField: "hotelSegment",
        description: "Target segment: Luxury, Boutique, Resort, Upscale, Midscale, Budget, Independent.",
        example: "BOUTIQUE",
        personalizationTag: "{{hotelSegment}}",
      },
      {
        name: "Contact Persona",
        mappedField: "contactPersona",
        description: "Standardized role category: General Manager, Operations Director, Owner, IT Director.",
        example: "GENERAL_MANAGER",
        personalizationTag: "{{contactPersona}}",
      },
    ],
    enrichmentColumns: [
      {
        name: "Hotel Brand / Group",
        mappedField: "custom:brand",
        description: "Parent hospitality brand or holding company.",
        example: "Taj / The Postcard",
      },
      {
        name: "Number of Rooms",
        mappedField: "custom:rooms",
        description: "Inventory size indicating operational scale.",
        example: "120",
      },
      {
        name: "Facilities & Amenities",
        mappedField: "custom:facilities",
        description: "Notable amenities: Spa, Banquet, Fine Dining, Private Pool.",
        example: "Ayurvedic Spa, Private Beach",
      },
      {
        name: "Star Rating or Category",
        mappedField: "custom:starRating",
        description: "Official 4-star, 5-star, or heritage designation.",
        example: "5-Star Heritage",
      },
      {
        name: "Training / Quality Challenges",
        mappedField: "custom:trainingChallenges",
        description: "Frontline SOP consistency issues or turnover bottlenecks.",
        example: "Multi-property SOP variance",
      },
      {
        name: "Source URL & Verification Status",
        mappedField: "custom:sourceUrl",
        description: "Reference link and whether checked by a researcher.",
        example: "Verified on official website",
      },
    ],
    removableColumns: [
      {
        name: "Serial Number / Internal Row ID",
        reason: "Internal spreadsheet counters are not needed for outreach.",
      },
      {
        name: "Raw GST / Tax ID",
        reason: "Administrative registry IDs are unnecessary for personalized outreach.",
      },
      {
        name: "Generic Reception Info Email (info@, contact@)",
        reason: "Generic inbox addresses usually bounce or yield low reply rates compared to named contacts.",
      },
    ],
    personalizationTip:
      "Having Hotel Name, Contact Person, and City unlocks over 90% of frontline execution templates.",
  },

  CO_MARKETING_PARTNERS: {
    type: "CO_MARKETING_PARTNERS",
    title: "Co-Marketing Partners",
    shortLabel: "Partners & Channel",
    badgeTone: "info",
    summary:
      "Hospitality training companies, recruitment agencies, hotel technology vendors, consultants, and potential channel partners.",
    sampleFileName: "co-marketing-partners-sample.csv",
    sampleCsv: `Company Name,Contact Person,Job Title,Contact Email,Company Website,Partner Category,Services Provided,Target Customers,Potential Partnership Opportunity,Personalization Angle
HTI India,Rajesh Mathur,Managing Director,rajesh.mathur@hti-india.test,https://hti-india.test,Hospitality Training,Customized frontline SOP training and brand learning programs,Hotels & Resorts,"HTI delivers employee training (LMS); FocusRealm verifies frontline execution (LTS)","Position FocusRealm as the operational verification layer that proves training works"
Webvi Placements,Sunita Rao,Head of Placements,sunita.rao@webvi.test,https://webvi.test,Recruitment Platform,Hospitality recruitment and job placement,Hotels & Restaurant Chains,"Webvi recruits talent; FocusRealm supports task execution post-hire","FocusRealm helps newly placed frontline staff adhere to SOPs and maintain quality standards"
Shaw Hotels & Consulting,Vikram Shaw,Principal Consultant,vikram.shaw@shawhotels.test,https://shawhotels.test,Consultancy & Audit,Mystery shopping and service-quality SOP audits,Boutique & Luxury Hotels,"Shaw audits identify operational gaps; FocusRealm tracks corrective task execution","Complement audit findings with automated daily SOP task enforcement"`,
    essentialColumns: [
      {
        name: "Company Name",
        mappedField: "company",
        description: "Partner organization or consultancy name.",
        example: "HTI India",
        personalizationTag: "{{company}}",
        essential: true,
      },
      {
        name: "Contact Email",
        mappedField: "email",
        description: "Direct email for partnership discussions.",
        example: "rajesh.mathur@hti-india.test",
        essential: true,
      },
    ],
    recommendedColumns: [
      {
        name: "Contact Person",
        mappedField: "fullName",
        description: "Partner executive or founder name.",
        example: "Rajesh Mathur",
        personalizationTag: "{{firstName}}",
      },
      {
        name: "Job Title",
        mappedField: "title",
        description: "Partner leadership role.",
        example: "Managing Director",
        personalizationTag: "{{title}}",
      },
      {
        name: "Company Website",
        mappedField: "custom:website",
        description: "Company domain for context and offering alignment.",
        example: "https://hti-india.test",
      },
      {
        name: "Partner Category",
        mappedField: "custom:partnerCategory",
        description: "Category: Hospitality Training, Recruitment Agency, Hotel Tech Provider, Consultant.",
        example: "Hospitality Training",
      },
      {
        name: "Services Provided",
        mappedField: "custom:whatItDoes",
        description: "Summary of services provided to hotels.",
        example: "Customized frontline training and SOP curriculum",
        personalizationTag: "{{whatItDoes}}",
      },
      {
        name: "Target Customers",
        mappedField: "custom:targetCustomers",
        description: "Client profile served by this partner.",
        example: "Boutique hotels & luxury chains",
      },
      {
        name: "Partnership Opportunity",
        mappedField: "custom:partnershipOpportunity",
        description: "Specific synergy between their service and FocusRealm.",
        example: "Verifying frontline service execution post-training",
        personalizationTag: "{{partnershipOpportunity}}",
      },
      {
        name: "Personalization Angle",
        mappedField: "custom:personalizationAngle",
        description: "Suggested conversational hook for email intro.",
        example: "Complementing LMS training with LTS service verification",
      },
    ],
    enrichmentColumns: [
      {
        name: "Source URL",
        mappedField: "custom:sourceUrl",
        description: "Where partner details were gathered.",
        example: "https://hti-india.test/about",
      },
      {
        name: "Verification Status",
        mappedField: "custom:verificationStatus",
        description: "Verification status of claims and services.",
        example: "VERIFIED",
      },
    ],
    removableColumns: [
      {
        name: "Competitor PMS Flags",
        reason: "FocusRealm focuses on service execution, not replacing PMS systems.",
      },
      {
        name: "Internal Vendor Billing Codes",
        reason: "Administrative finance keys do not assist partner outreach.",
      },
    ],
    personalizationTip:
      "Map 'Services Provided' and 'Partnership Opportunity' to enable the Co-Market Partnership template.",
  },

  GENERAL_BUSINESS: {
    type: "GENERAL_BUSINESS",
    title: "General Business Prospects",
    shortLabel: "General Business",
    badgeTone: "neutral",
    summary: "Companies, vendors, executive prospects, and general business contacts across industries.",
    sampleFileName: "general-business-sample.csv",
    sampleCsv: `Company Name,Contact Person,Job Title,Contact Email,Company Website,City,Industry,Notes
Apex Enterprise Solutions,Kunal Shah,VP of Technology,kunal.shah@apexenterprise.test,https://apexenterprise.test,Mumbai,Software & Tech,Enterprise workflow automation prospect
Zenith Corporate Services,Ananya Sen,Director of Operations,ananya.sen@zenithcorp.test,https://zenithcorp.test,Bengaluru,Business Consulting,Multi-city operations lead
Metro Commercial Logistics,Suresh Patel,Chief Operating Officer,suresh.patel@metrologistics.test,https://metrologistics.test,Ahmedabad,Supply Chain & Logistics,Fleet and facility operations management`,
    essentialColumns: [
      {
        name: "Company Name",
        mappedField: "company",
        description: "Company or enterprise name.",
        example: "Apex Enterprise Solutions",
        personalizationTag: "{{company}}",
        essential: true,
      },
      {
        name: "Contact Email",
        mappedField: "email",
        description: "Corporate or work email.",
        example: "kunal.shah@apexenterprise.test",
        essential: true,
      },
    ],
    recommendedColumns: [
      {
        name: "Contact Person",
        mappedField: "fullName",
        description: "Full contact name.",
        example: "Kunal Shah",
        personalizationTag: "{{firstName}}",
      },
      {
        name: "Job Title",
        mappedField: "title",
        description: "Executive position or functional role.",
        example: "VP of Technology",
        personalizationTag: "{{title}}",
      },
      {
        name: "Website",
        mappedField: "custom:website",
        description: "Corporate domain.",
        example: "https://apexenterprise.test",
      },
      {
        name: "City",
        mappedField: "custom:city",
        description: "Headquarters or branch office city.",
        example: "Mumbai",
        personalizationTag: "{{city}}",
      },
    ],
    enrichmentColumns: [
      {
        name: "Industry / Sector",
        mappedField: "custom:industry",
        description: "Primary industry or market segment.",
        example: "Software & Technology",
      },
      {
        name: "Phone Number",
        mappedField: "phone",
        description: "Office or mobile contact number.",
        example: "+91 22 2847 9000",
      },
      {
        name: "Notes / Research Context",
        mappedField: "custom:notes",
        description: "Qualifying notes or lead source history.",
        example: "Met at TechEx Mumbai",
      },
    ],
    removableColumns: [
      {
        name: "Fax Number",
        reason: "Legacy communication channels are not utilized for modern email outreach.",
      },
      {
        name: "Employee Count Bracket",
        reason: "Unless referenced in copy, general brackets can be omitted.",
      },
    ],
    personalizationTip:
      "Map First Name and Company Name to ensure warm introductory opening lines.",
  },
};
