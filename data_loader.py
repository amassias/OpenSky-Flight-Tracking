#!/usr/bin/env python3
"""
Data loader for airports and airlines
Loads ICAO airports and airline names from CSV files
"""
import csv
import os
import sys
from typing import Dict, List, Tuple

# Cache pour éviter de recharger les fichiers à chaque fois
_airports_cache = None
_airlines_cache = None

def load_airports() -> Dict[str, Dict[str, str]]:
    """
    Charge tous les aéroports depuis iata-icao.csv
    Retourne un dict: {ICAO: {name, city, country, iata, lat, lon}}
    """
    global _airports_cache
    if _airports_cache is not None:
        return _airports_cache
    
    airports = {}
    # Look for airports CSV in the new data/ folder (relative to this file)
    csv_path = os.path.join(os.path.dirname(__file__), 'data', 'iata-icao.csv')
    
    if not os.path.exists(csv_path):
        print(f"Warning: {csv_path} not found", file=sys.stderr)
        return airports
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                icao = row.get('icao', '').strip()
                if icao and icao != '':  # Ignorer les lignes sans ICAO
                    airport_name = row.get('airport', '').strip()
                    iata = row.get('iata', '').strip()
                    country = row.get('country_code', '').strip()
                    region = row.get('region_name', '').strip()
                    
                    # Créer un nom d'affichage : "Airport Name (IATA) - City, Country"
                    display_name = airport_name
                    if iata:
                        display_name = f"{airport_name} ({iata})"
                    if region:
                        display_name = f"{display_name} - {region}, {country}"
                    elif country:
                        display_name = f"{display_name} - {country}"
                    
                    airports[icao] = {
                        'name': airport_name,
                        'iata': iata,
                        'display_name': display_name,
                        'country': country,
                        'region': region,
                        'latitude': row.get('latitude', ''),
                        'longitude': row.get('longitude', '')
                    }
        
        _airports_cache = airports
        print(f"✅ Loaded {len(airports)} airports from {csv_path}", file=sys.stderr)
        
    except Exception as e:
        print(f"Error loading airports: {e}", file=sys.stderr)
    
    return airports


def load_airlines() -> Dict[str, str]:
    """
    Charge les compagnies aériennes depuis 'Airlines data'
    Retourne un dict: {ICAO_CODE: Airline_Name}
    Le fichier a ce format CSV:
    id,name,alias,iata,icao,callsign,country,active
    """
    global _airlines_cache
    if _airlines_cache is not None:
        return _airlines_cache
    
    airlines = {}
    # Look for airlines CSV in the new data/ folder (relative to this file)
    csv_path = os.path.join(os.path.dirname(__file__), 'data', 'Airlines data')
    
    if not os.path.exists(csv_path):
        print(f"Warning: {csv_path} not found", file=sys.stderr)
        return airlines
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 5:
                    airline_name = row[1].strip()
                    icao_code = row[4].strip()
                    
                    # Ignorer les entrées sans code ICAO valide
                    if icao_code and icao_code not in ['\\N', '', 'N/A']:
                        airlines[icao_code] = airline_name
        
        _airlines_cache = airlines
        print(f"✅ Loaded {len(airlines)} airlines from {csv_path}", file=sys.stderr)
        
    except Exception as e:
        print(f"Error loading airlines: {e}", file=sys.stderr)
    
    return airlines


def get_airport_name(icao: str) -> str:
    """Retourne le nom d'affichage d'un aéroport depuis son code ICAO"""
    airports = load_airports()
    return airports.get(icao, {}).get('display_name', icao)


def get_airline_name(icao_code: str) -> str:
    """Retourne le nom de la compagnie depuis son code ICAO (3 lettres du callsign)"""
    airlines = load_airlines()
    return airlines.get(icao_code, icao_code)


def search_airports(query: str, limit: int = 50) -> List[Tuple[str, str]]:
    """
    Recherche d'aéroports par nom, code ICAO, IATA ou pays
    Retourne une liste de tuples (icao, display_name)
    """
    airports = load_airports()
    query_lower = query.lower()
    results = []
    
    for icao, data in airports.items():
        # Recherche dans tous les champs pertinents
        if (query_lower in data['display_name'].lower() or
            query_lower in icao.lower() or
            query_lower in data['iata'].lower() or
            query_lower in data['country'].lower() or
            query_lower in data['region'].lower()):
            results.append((icao, data['display_name']))
            
            if len(results) >= limit:
                break
    
    return results


if __name__ == "__main__":
    # Test du module
    print("\n=== Test du chargement des données ===\n")
    
    airports = load_airports()
    print(f"Nombre d'aéroports chargés: {len(airports)}")
    
    airlines = load_airlines()
    print(f"Nombre de compagnies chargées: {len(airlines)}")
    
    print("\n=== Exemples d'aéroports ===")
    test_icao = ['LFPG', 'EGLL', 'KJFK', 'OMDB', 'RJTT']
    for icao in test_icao:
        if icao in airports:
            print(f"{icao}: {airports[icao]['display_name']}")
    
    print("\n=== Exemples de compagnies ===")
    test_airlines = ['AFR', 'BAW', 'UAL', 'DLH', 'UAE']
    for code in test_airlines:
        print(f"{code}: {get_airline_name(code)}")
    
    print("\n=== Recherche d'aéroports (Paris) ===")
    results = search_airports('Paris', limit=10)
    for icao, name in results:
        print(f"{icao}: {name}")
