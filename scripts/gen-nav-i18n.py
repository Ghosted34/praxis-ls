#!/usr/bin/env python3
"""Generate the `nav` section of i18n-dict.ts from areas.ts + nav-model.ts labels.
EN side = the source labels verbatim (key = label, value = label); FR side comes
from the translation map below. Prints the block to insert."""
import re, json, sys

# ---- 1. Collect unique labels from source files ----
src = open("client/src/app/layout/areas.ts").read()
labels = set(re.findall(r'label: "([^"]+)"', src))
navm = open("client/src/app/layout/nav-model.ts").read()
labels |= set(re.findall(r'(?:heading|label): "([^"]+)"', navm))
labels |= {"Search (⌘K)", "Edit shortcuts", "Shortcuts", "Primary"}

# ---- 2. FR translations (hand-written) ----
FR = {
 "Control Tower": "Tour de contrôle", "My workspace": "Mon espace de travail",
 "Praxis AI": "IA Praxis", "Smart Comms": "Comms intelligentes",
 "Support & feedback": "Support & retours", "Sales & CRM": "Ventes & CRM",
 "Commercial": "Commercial", "Procurement": "Achats", "Operations": "Opérations",
 "Warehouse": "Entrepôt", "Fleet": "Flotte", "Finance": "Finance",
 "Costing": "Coûts", "People & HR": "Personnel & RH", "Master data": "Données de base",
 "Vault & compliance": "Coffre & conformité", "Security & access": "Sécurité & accès",
 "Governance": "Gouvernance", "Settings & admin": "Paramètres & admin",
 "God mode": "Mode Dieu", "AI control": "Contrôle IA",
 "AI Control": "Contrôle IA", "Comms": "Comms",
 "Security & Access": "Sécurité & accès", "Settings & Admin": "Paramètres & admin",
 "Vault": "Coffre",
 "Leads & intake": "Prospects & réception", "Contact enquiries": "Demandes de contact",
 "Quote requests": "Demandes de devis", "Opportunities": "Opportunités",
 "Proposals": "Propositions", "Company profile": "Profil d'entreprise",
 "Meetings": "Réunions", "Campaigns": "Campagnes", "Partnerships": "Partenariats",
 "Success stories": "Témoignages", "Quotations": "Devis",
 "Margin simulation": "Simulation de marge",
 "Extra-charge simulation": "Simulation de frais supplémentaires",
 "Pricing variance": "Écart de prix", "Requests": "Demandes",
 "Purchase orders": "Commandes fournisseurs", "Goods received": "Marchandises reçues",
 "Supplier invoices": "Factures fournisseurs", "Files": "Dossiers",
 "Milestones": "Jalons", "Transit orders": "Ordres de transit",
 "Delivery notes": "Bordereaux de livraison", "Locations": "Emplacements",
 "Inventory": "Inventaire", "Inbound / GRN": "Entrées / BR", "Outbound": "Sorties",
 "Equipment": "Équipement", "Cycle counts": "Comptages", "Vehicles": "Véhicules",
 "Compliance": "Conformité", "Work orders": "Ordres de travail",
 "Dispatch": "Expédition", "Fuel log": "Journal de carburant",
 "Drivers": "Chauffeurs", "Incidents": "Incidents", "Invoices": "Factures",
 "Proforma & advances": "Proforma & avances", "Receivables": "Créances",
 "Credit notes": "Avoirs", "Journals": "Journaux",
 "Chart of accounts": "Plan comptable", "Statements": "États financiers",
 "Tax center": "Centre fiscal", "Assets": "Immobilisations",
 "Financing": "Financement", "Cost tracking": "Suivi des coûts",
 "Cash requests": "Demandes de fonds", "Régie": "Régie", "Employees": "Employés",
 "Payroll": "Paie", "Advances": "Avances", "Vacancies": "Postes vacants",
 "Contracts": "Contrats", "Appraisals": "Évaluations", "Queries": "Requêtes",
 "Sanctions": "Sanctions", "Attendance": "Présences", "Leave": "Congés",
 "Trainings": "Formations", "SOPs": "Procédures", "Talent pool": "Vivier de talents",
 "Clients": "Clients", "Suppliers": "Fournisseurs",
 "Corporate entities": "Entités juridiques", "Treasury": "Trésorerie",
 "Currencies": "Devises", "Expense rates": "Taux de frais",
 "Financial dictionary": "Dictionnaire financier", "Tax": "Fiscalité",
 "Service types": "Types de service", "Overview": "Vue d'ensemble",
 "Documents": "Documents", "Signatures": "Signatures",
 "Verification": "Vérification", "Compliance flags": "Alertes de conformité",
 "Reports": "Rapports", "Users": "Utilisateurs", "Roles": "Rôles",
 "Permission matrix": "Matrice des permissions", "Capabilities": "Capacités",
 "Scopes": "Périmètres", "Field visibility": "Visibilité des champs",
 "Sessions": "Sessions", "My security": "Ma sécurité",
 "Approvals": "Approbations", "Workflows": "Flux de travail",
 "Audit ledger": "Registre d'audit", "Notifications": "Notifications",
 "Features": "Fonctionnalités", "Access": "Accès", "Budget": "Budget",
 "Usage": "Utilisation", "Appearance": "Apparence", "Numbering": "Numérotation",
 "Templates": "Modèles", "Custom fields": "Champs personnalisés",
 "Pipeline stages": "Étapes du pipeline", "Scheduled reports": "Rapports planifiés",
 "API keys": "Clés API", "Module catalogue": "Catalogue des modules",
 "Mailbox": "Boîte mail", "Search (⌘K)": "Recherche (⌘K)",
 "Edit shortcuts": "Modifier les raccourcis", "Shortcuts": "Raccourcis",
 "Primary": "Principal",
}

missing = sorted(l for l in labels if l not in FR)
if missing:
    print("MISSING FR:", missing, file=sys.stderr)

def block(lang_map, indent="    "):
    lines = []
    for label in sorted(labels):
        lines.append(f'{indent}  "{label}": "{lang_map[label]}",')
    return "\n".join(lines)

print("/* GENERATED nav section — en */")
print(block({l: l for l in labels}))
print("/* GENERATED nav section — fr */")
print(block(FR))
