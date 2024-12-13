import { Component, EventEmitter, Output } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CardComponent } from '../card/card.component';

@Component({
  selector: 'app-search',
  imports: [CardComponent],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent {

  @Output() searchPerformed = new EventEmitter<{
    title: string, imageUrl: string, lowestEbayPrice: string, lowestGuitarPrice: string,
    lowestAliExpressPrice: string, bestPrice: string, bestPriceUrl: string }[]>();

  selectedColor: string = '';
  searchResults: {
    title: string, imageUrl: string, price: string, lowestEbayPrice: string,
    lowestGuitarPrice: string, lowestAliExpressPrice: string, bestPrice: string, bestPriceUrl: string }[] = [];

  constructor(private http: HttpClient) {}

  getSearchValue(color: string): string {
    return color === 'black' ? '761294513118' : color === 'white' ? '761294512418' : '';
  }

  selectColor(color: string) {
    this.selectedColor = color;
  }

  performSearch() {
    const searchValue = this.getSearchValue(this.selectedColor);
    this.http.post('/scrape', { searchValue }).subscribe(
      (response: any) => {
        this.searchResults = response.results
          .filter((result: any) => result !== null)
          .map((result: any) => ({
            title: result.title,
            imageUrl: result.imageUrl,
            price: response.lowestAmazonPrice,
            lowestEbayPrice: response.lowestBrandNewEbayPrice.price,
            lowestGuitarPrice: response.lowestGuitarPrice,
            lowestAliExpressPrice: response.lowestAliExpressPrice,
            bestPrice: response.bestPrice,
            bestPriceUrl: response.bestPriceURL
          }));

        console.log('Search Results:', this.searchResults[0]);
      },
      (error) => {
        console.error('Error performing search:', error);
      }
    );
  }
}
