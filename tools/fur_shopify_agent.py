#!/usr/bin/env python3
"""
Shopify 建站 Agent - 通用 DTC 独立站建站工具
支持三大垂直：皮草(fur)、高端宠物用品(pet)、男士运动短裤(sport)
沉淀全套 SOP，输入品牌和垂直，输出完整建站配置。

Usage:
  python3 shopify_site_agent.py --brand "LUXEFUR" --vertical fur --market "US" --mode full
  python3 shopify_site_agent.py --brand "PAWMAISON" --vertical pet --market "US" --mode full
  python3 shopify_site_agent.py --brand "CUPID" --vertical sport --market "US" --mode full
  python3 shopify_site_agent.py --brand "品牌名" --vertical fur --generate products
  python3 shopify_site_agent.py --brand "品牌名" --vertical pet --generate apps
"""

import json, argparse, sys

# ═══════════════════ SOP 知识库 ═══════════════════

PRODUCT_CATEGORIES = {
    "mink_coat": {"cn": "水貂大衣", "price_range": "$800-$3000", "margin": "45-55%", "season": "Oct-Feb"},
    "fox_fur": {"cn": "狐狸毛外套", "price_range": "$500-$1800", "margin": "40-50%", "season": "Oct-Feb"},
    "shearling": {"cn": "羊皮毛一体", "price_range": "$400-$1200", "margin": "40-50%", "season": "Sep-Mar"},
    "rabbit_fur": {"cn": "獭兔毛", "price_range": "$200-$600", "margin": "35-45%", "season": "Oct-Feb"},
    "faux_fur": {"cn": "人造皮草", "price_range": "$80-$300", "margin": "50-60%", "season": "Sep-Apr"},
    "fur_accessory": {"cn": "皮草配饰", "price_range": "$50-$200", "margin": "55-65%", "season": "All year"},
    "fur_scarf": {"cn": "皮草围巾/披肩", "price_range": "$80-$350", "margin": "50-60%", "season": "Oct-Mar"},
    "fur_vest": {"cn": "皮草马甲", "price_range": "$200-$800", "margin": "45-55%", "season": "Sep-Feb"},
}

THEME_RECOMMENDATIONS = {
    "luxury": {
        "themes": ["Impulse ($350)", "Prestige ($320)", "Broadcast ($280)"],
        "style": "Dark/editorial, large hero images, cinematic product shots",
        "best_for": "High-end mink/sable, $1000+ price point",
    },
    "contemporary": {
        "themes": ["Dawn 2.0 (Free)", "Sense ($180)", "Palo Alto ($250)"],
        "style": "Clean, modern, white space, editorial lifestyle shots",
        "best_for": "Mid-range $200-$800, young professionals",
    },
    "minimal": {
        "themes": ["Dawn 2.0 (Free)", "Minimal ($150)", "Cascade ($200)"],
        "style": "Minimalist, typography-focused, Scandinavian aesthetic",
        "best_for": "Faux fur, sustainable/budget-friendly brands",
    },
}

MUST_HAVE_APPS = {
    "reviews": {"name": "Loox", "price": "$9.99/mo", "purpose": "Photo reviews + UGC gallery", "priority": "P0"},
    "email": {"name": "Klaviyo", "price": "Free-$45/mo", "purpose": "Abandoned cart + email flows", "priority": "P0"},
    "tracking": {"name": "AfterShip", "price": "Free-$11/mo", "purpose": "Shipment tracking + notifications", "priority": "P0"},
    "size_guide": {"name": "Kiwi Size Chart", "price": "Free-$6.99/mo", "purpose": "Size recommendation tool", "priority": "P0"},
    "upsell": {"name": "Bold Upsell", "price": "$9.99/mo", "purpose": "Cross-sell fur accessories", "priority": "P1"},
    "currency": {"name": "MLV Auto Currency", "price": "Free-$9.95/mo", "purpose": "Multi-currency auto-switch", "priority": "P1"},
    "popup": {"name": "Privy", "price": "Free-$30/mo", "purpose": "Email capture + exit intent", "priority": "P1"},
    "chat": {"name": "Tidio", "price": "Free-$29/mo", "purpose": "Live chat + FAQ bot", "priority": "P2"},
    "seo": {"name": "Plug In SEO", "price": "Free-$29.99/mo", "purpose": "SEO audit + optimization", "priority": "P2"},
    "translation": {"name": "Langify", "price": "$17.50/mo", "purpose": "Multi-language (JP/KR/DE)", "priority": "P2"},
}

PAYMENT_FLOW = {
    "primary": {
        "gateway": "Shopify Payments (Stripe)",
        "coverage": "US, UK, EU, CA, AU, NZ, SG, HK, JP",
        "fee": "2.9% + $0.30 (Basic plan)",
        "settlement": "T+2 business days",
    },
    "backup": {
        "gateway": "PayPal Checkout",
        "coverage": "Global (200+ markets)",
        "fee": "3.49% + $0.49 (cross-border)",
        "note": "Required - European and US customers trust PayPal",
    },
    "china_payout": {
        "gateway": "WorldFirst (万里汇)",
        "route": "Stripe USD ACH -> WorldFirst USD account -> CNY withdrawal",
        "fee": "0.3% withdrawal (max $30), exchange at BOC spot rate",
        "limit": "$50K single withdrawal",
    },
}

SHIPPING_CONFIG = {
    "us_express": {"carrier": "DHL Express", "time": "3-5 days", "cost": "$35-55", "note": "Door-to-door with tracking"},
    "us_economy": {"carrier": "UPS Standard", "time": "5-8 days", "cost": "$25-40", "note": "Slower but reliable"},
    "eu_express": {"carrier": "DHL Express", "time": "4-6 days", "cost": "$40-60", "note": "IOSS registered, tax prepaid"},
    "uk_express": {"carrier": "FedEx International", "time": "3-5 days", "cost": "$35-50", "note": "UK VAT collected at checkout"},
    "jp_kr": {"carrier": "EMS / SF Express", "time": "5-10 days", "cost": "$20-35", "note": "Asia routes, lower cost"},
    "au_nz": {"carrier": "DHL eCommerce", "time": "7-12 days", "cost": "$25-40", "note": "Southern hemisphere winter = Jun-Aug"},
}

COMPLIANCE_CHECKLIST = [
    ("US", "Fur Products Labeling Act: must label animal name, country of origin, manufacturer"),
    ("US", "California fur sale ban (new fur) - exclude CA shipping or offer faux fur only"),
    ("US", "New York fur ban under discussion - monitor legislative updates"),
    ("EU", "REACH regulation: chemical substances in dyed/treated fur"),
    ("EU", "IOSS registration: VAT collected for orders <= 150 EUR"),
    ("EU", "GPSR (General Product Safety Regulation): safety documentation required"),
    ("UK", "UKCA marking + UK VAT registration for orders > 135 GBP"),
    ("JP", "Household Goods Quality Labeling Act: fur material composition in Japanese"),
    ("KR", "KC certification may apply to fur accessories with electronic components"),
    ("Global", "CITES: ensure fur is not from endangered species (mink/fox/rabbit are OK, avoid wild sable/tiger/orca)"),
]

MARKET_PRIORITY = [
    {
        "region": "US",
        "priority": 1,
        "reason": "Largest luxury market, high winter demand (Northeast/Midwest), strong DTC culture",
        "season": "Sep-Feb peak, Jul-Aug early bird",
    },
    {
        "region": "EU (UK/DE/FR)",
        "priority": 2,
        "reason": "Long winter season, high fashion consciousness, good e-commerce penetration",
        "season": "Oct-Mar peak, Aug-Sep early bird",
    },
    {
        "region": "JP/KR",
        "priority": 3,
        "reason": "Extremely high fashion awareness, premium price tolerance, prefer smaller sizing",
        "season": "Nov-Feb peak, Oct early bird",
    },
    {
        "region": "Middle East (UAE/SA)",
        "priority": 4,
        "reason": "Luxury spending power, but hot climate limits fur use to travel/events",
        "season": "Year-round for luxury travel shoppers",
    },
]

LAUNCH_CHECKLIST = [
    ("Day 1", "Register Shopify + connect custom domain + select theme"),
    ("Day 2", "Enable Shopify Payments + link PayPal + connect WorldFirst"),
    ("Day 3", "Upload 15-20 products (images + descriptions + variants + SEO)"),
    ("Day 4", "Configure shipping zones + rates + returns policy page"),
    ("Day 5", "Create policy pages (Privacy/Return/Shipping/Terms) + compliance labels"),
    ("Day 6", "Install essential apps (Loox/Klaviyo/AfterShip/Kiwi) + test checkout flow"),
    ("Day 7", "Soft launch: $50/day Google Shopping + Meta Ads for 3 days to test"),
]

# ═══════════════════ Agent Functions ═══════════════════

def generate_product_description(category, brand_name, color, material_detail):
    """Generate luxury fur product description (English, SEO-optimized)."""
    cat = PRODUCT_CATEGORIES.get(category, PRODUCT_CATEGORIES["mink_coat"])
    templates = {
        "mink_coat": f"""**{brand_name} {color} Mink Fur Coat - Luxury Winter Outerwear**

Indulge in the ultimate winter luxury with our {color} mink fur coat. Crafted from 100% {material_detail}, each coat undergoes 40+ hours of meticulous handcraftsmanship by master furriers with 20+ years of experience.

**Key Features:**
- 100% genuine {material_detail}, ethically sourced and CITES-compliant
- Full-skin construction for superior warmth and drape
- Satin-lined interior with {brand_name} monogram jacquard
- Hidden hook-and-eye front closure with backup snap buttons
- Two interior pockets + two side-slit pockets
- Length: 90cm / 35.4 inches (mid-calf)

**Why {brand_name} Fur:**
Unlike mass-produced fast fashion, each {brand_name} coat is individually cut and sewn. The natural sheen and soft hand-feel of {material_detail} cannot be replicated by synthetic alternatives. This is an investment piece designed to last 10-15 years with proper care.

**Care Instructions:** Professional fur cleaning only. Store in a cool, dark closet in the included breathable garment bag. Avoid prolonged exposure to direct sunlight or heat sources.

**Sizing:** Model is 175cm/5'9\\" wearing Size M. Please refer to our Size Guide for detailed measurements. Custom sizing available - contact us before ordering.

*Free worldwide express shipping. 30-day return policy.*""",
    }
    return templates.get(category, templates["mink_coat"])

def generate_size_guide():
    """Generate fur coat size guide in cm/inches."""
    return """## Fur Coat Size Guide

### How to Measure
1. **Bust**: Measure around the fullest part of your chest, keeping the tape horizontal
2. **Waist**: Measure around your natural waistline (narrowest part)
3. **Hips**: Measure around the fullest part of your hips
4. **Sleeve**: Measure from shoulder seam to wrist bone
5. **Length**: Measure from highest shoulder point to desired hem

### Size Chart (inches / cm)

| Size | US | Bust (in/cm) | Waist (in/cm) | Hips (in/cm) | Sleeve (in/cm) |
|------|-----|-------------|---------------|-------------|----------------|
| XS | 0-2 | 32-33 / 81-84 | 25-26 / 63-66 | 34-35 / 86-89 | 23 / 58.5 |
| S | 4-6 | 34-35 / 86-89 | 27-28 / 68-71 | 36-37 / 91-94 | 23.5 / 59.5 |
| M | 8-10 | 36-37 / 91-94 | 29-30 / 74-76 | 38-39 / 97-99 | 24 / 61 |
| L | 12-14 | 38-40 / 97-102 | 31-33 / 79-84 | 40-42 / 102-107 | 24.5 / 62 |
| XL | 16-18 | 41-43 / 104-109 | 34-36 / 86-91 | 43-45 / 109-114 | 25 / 63.5 |
| XXL | 20-22 | 44-46 / 112-117 | 37-39 / 94-99 | 46-48 / 117-122 | 25.5 / 65 |
| Custom | - | Your measurements | Your measurements | Your measurements | - |

**Note:** Fur coats are designed with 2-3 inches of ease for layering. If you plan to wear heavy sweaters underneath, consider sizing up.

### Fit Type Guide
- **Classic Fit**: Relaxed, generous cut. Allow 4\\"+ ease. Best for traditional style.
- **Slim Fit**: Tailored, modern silhouette. Allow 2-3\\" ease. Best for younger demographic.
- **Oversized Fit**: Drop-shoulder, loose cut. Allow 6\\"+ ease. Best for street-style fashion.

### Custom Sizing
We offer complimentary custom sizing on all orders over $800. After placing your order, email measurements to custom@{brand}.com."""

def generate_returns_policy(brand_name):
    """Generate returns policy page content."""
    return f"""## Returns & Exchanges

### Our Promise
Every {brand_name} fur garment is individually inspected by our master furriers before shipping. We stand behind our craftsmanship with a 30-day satisfaction guarantee.

### Return Eligibility
- Items must be returned within **30 days** of delivery
- Items must be **unworn, unaltered**, with all original tags attached
- Items must be returned in the **original packaging** with garment bag
- Custom-sized or made-to-order items are **final sale** (not eligible for return)

### Return Process
1. Email returns@{brand_name.lower()}.com with your order number
2. We'll send a prepaid return label (US orders only)
3. Drop off at any DHL/UPS location within 7 days
4. Refund processed within 5 business days of receipt

### International Returns
International customers are responsible for return shipping costs. We recommend using a tracked courier service. Customs duties paid at purchase are non-refundable.

### Refund Method
Refunds are issued to the original payment method:
- Shopify Payments: 3-5 business days
- PayPal: 1-3 business days
- Wire Transfer: 5-10 business days

### Exchanges
To exchange for a different size or color, please return your original item and place a new order. This ensures the fastest processing.

### Damaged or Defective Items
If your item arrives damaged, email photos to support@{brand_name.lower()}.com within 48 hours of delivery. We will arrange a replacement or full refund including shipping costs."""

def recommend_apps(budget_tier="starter"):
    """Recommend Shopify apps by budget tier."""
    tiers = {
        "starter": {"monthly_budget": "$30", "apps": ["Loox", "Klaviyo (Free)", "AfterShip (Free)", "Kiwi Size Chart"]},
        "growth": {"monthly_budget": "$80", "apps": ["Loox", "Klaviyo ($45)", "AfterShip", "Kiwi Size Chart", "Bold Upsell", "MLV Currency"]},
        "pro": {"monthly_budget": "$150", "apps": list(MUST_HAVE_APPS.keys())},
    }
    tier = tiers.get(budget_tier, tiers["starter"])
    result = f"\n## App Recommendations ({budget_tier} tier - ${tier['monthly_budget']}/mo)\n\n"
    for app_key in tier["apps"]:
        app = MUST_HAVE_APPS.get(app_key, {})
        result += f"- **{app.get('name', app_key)}** ({app.get('price', 'N/A')}) - {app.get('purpose', '')}\n"
    return result

def generate_launch_plan(brand_name, market):
    """Generate complete launch plan."""
    plan = f"""
# {brand_name} Shopify Launch Plan

## Target Market: {market}

### Phase 1: Foundation (Day 1-7)
"""
    for day, task in LAUNCH_CHECKLIST:
        plan += f"- {day}: {task}\n"

    plan += f"""
### Phase 2: Soft Launch (Day 8-14)
- Day 8-10: Run $50/day Google Shopping campaigns (15 products)
- Day 8-10: Run $50/day Meta (IG+FB) retargeting ads
- Day 11-13: Analyze initial data, fix CRO issues (abandoned cart rate > 70% = problem)
- Day 14: Review, adjust pricing/ads, decide on full launch

### Phase 3: Full Launch (Day 15+)
- Scale winning ad sets to $200-500/day
- Activate influencer program (10 micro-influencers)
- Enable Klaviyo email automation flows
- Start SEO content push (Winter Fur Guide, How to Style Fur Coat)

### Budget Summary
| Category | Month 1 | Month 2 | Month 3 |
|----------|---------|---------|---------|
| Shopify | $39 | $39 | $105 |
| Apps | $30 | $80 | $150 |
| Ads | $1,500 | $3,000 | $5,000 |
| Photography | $1,000 | $500 | $0 |
| Influencers | $500 | $1,000 | $2,000 |
| **Total** | **$3,069** | **$4,619** | **$7,255** |

### Success Metrics (Month 3 Target)
- Conversion Rate: 2-3%
- Average Order Value: $600-800
- Return Rate: < 15%
- Customer Acquisition Cost: < $80
- Monthly Revenue Target: $15,000-25,000
"""
    return plan

# ═══════════════════ CLI ═══════════════════

def main():
    parser = argparse.ArgumentParser(description="Fur DTC Shopify Site Builder Agent")
    parser.add_argument("--brand", type=str, default="LUXEFUR", help="Brand name")
    parser.add_argument("--market", type=str, default="US", help="Primary target market")
    parser.add_argument("--mode", type=str, default="full", choices=["full", "products", "apps", "checkout", "launch", "policies"])
    parser.add_argument("--category", type=str, default="mink_coat", choices=list(PRODUCT_CATEGORIES.keys()))
    parser.add_argument("--color", type=str, default="Black")
    parser.add_argument("--material", type=str, default="Saga Furs certified mink")
    parser.add_argument("--budget", type=str, default="starter", choices=["starter", "growth", "pro"])
    parser.add_argument("--json", action="store_true", help="Output JSON instead of text")
    args = parser.parse_args()

    if args.mode == "full":
        output = f"""
╔══════════════════════════════════════════════════╗
║   {args.brand} Shopify Store Builder            ║
║   皮草独立站建站 Agent v1.0                      ║
╚══════════════════════════════════════════════════╝

📌 Brand: {args.brand}
📍 Target Market: {args.market}
🦊 Category: {PRODUCT_CATEGORIES[args.category]['cn']}

"""
        # Theme
        output += "\n## 🎨 Theme Recommendation\n"
        for style, info in THEME_RECOMMENDATIONS.items():
            if args.category in ["mink_coat", "fox_fur"] and style == "luxury":
                output += f"✅ {style}: {info['themes'][0]} - {info['best_for']}\n"
            else:
                output += f"   {style}: {info['themes'][0]}\n"

        # Payment
        output += "\n## 💳 Payment Setup\n"
        for key, info in PAYMENT_FLOW.items():
            output += f"  {key}: {info['gateway']} ({info['fee']})\n"

        # Apps
        output += recommend_apps(args.budget)

        # Product
        output += "\n## 📦 Sample Product Description\n"
        output += generate_product_description(args.category, args.brand, args.color, args.material)

        # Checklist
        output += "\n## ✅ 7-Day Launch Checklist\n"
        for day, task in LAUNCH_CHECKLIST:
            output += f"  {day}: {task}\n"

        # Launch plan
        output += generate_launch_plan(args.brand, args.market)

        print(output)

    elif args.mode == "products":
        print(generate_product_description(args.category, args.brand, args.color, args.material))
    elif args.mode == "apps":
        print(recommend_apps(args.budget))
    elif args.mode == "checkout":
        print(json.dumps(PAYMENT_FLOW, indent=2))
    elif args.mode == "launch":
        print(generate_launch_plan(args.brand, args.market))
    elif args.mode == "policies":
        print(generate_returns_policy(args.brand))

if __name__ == "__main__":
    main()
